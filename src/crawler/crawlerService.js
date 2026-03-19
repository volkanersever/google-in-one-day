import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { JOB_STATUS, HTML_CONTENT_TYPES } from '../shared/constants.js';
import { normalizeUrl, shouldSkipByExtension, getHostname } from './urlUtils.js';
import { extractTitle, extractLinks, extractText } from './htmlParser.js';
import { RateLimiter, HostDelayTracker } from './rateLimiter.js';
import { RobotsChecker } from './robots.js';
import { FrontierQueue } from './frontierQueue.js';
import { Scheduler } from './scheduler.js';
import { CrawlRepository } from '../storage/crawlRepository.js';
import { PageRepository } from '../storage/pageRepository.js';
import { IndexService } from '../indexer/indexService.js';

const log = createLogger('crawler');

/**
 * Core crawler service. Manages crawl jobs, worker pool, and orchestration.
 */
export class CrawlerService {
  constructor() {
    this.frontier = new FrontierQueue();
    this.scheduler = new Scheduler(this.frontier);
    this.crawlRepo = new CrawlRepository();
    this.pageRepo = new PageRepository();
    this.indexService = new IndexService();
    this.rateLimiter = new RateLimiter(config.globalRps);
    this.hostDelay = new HostDelayTracker(config.perHostDelayMs);
    this.robots = new RobotsChecker();

    this.activeWorkers = 0;
    this.maxWorkers = config.maxWorkers;
    this.running = false;
    this.throttled = false;
    this.activeJobs = new Map(); // jobId -> job metadata
  }

  /**
   * Start a new crawl job: index(origin, k)
   */
  async startJob(originUrl, maxDepth) {
    const job = this.crawlRepo.createJob(originUrl, maxDepth);
    log.info(`Created job ${job.id} for ${originUrl} depth=${maxDepth}`);

    // Normalize and enqueue the origin URL
    const normalized = normalizeUrl(originUrl);
    if (!normalized) {
      this.crawlRepo.updateJobStatus(job.id, JOB_STATUS.FAILED);
      throw new Error(`Invalid origin URL: ${originUrl}`);
    }

    this.crawlRepo.updateJobStatus(job.id, JOB_STATUS.RUNNING);
    this.activeJobs.set(job.id, { originUrl, maxDepth, startedAt: Date.now() });

    const result = this.scheduler.schedule({
      normalizedUrl: normalized,
      url: originUrl,
      jobId: job.id,
      originUrl: originUrl,
      depth: 0,
      discoveredFromUrl: null,
    });

    if (result.enqueued) {
      this.crawlRepo.incrementCounter(job.id, 'discovered_count');
      this.crawlRepo.incrementCounter(job.id, 'queued_count');
    }

    // Start worker loop if not already running
    if (!this.running) {
      this.running = true;
      this.runWorkerLoop();
    }

    return this.crawlRepo.getJob(job.id);
  }

  /**
   * Main worker loop: continuously dequeues and processes URLs.
   */
  async runWorkerLoop() {
    log.info('Worker loop started');

    while (this.running) {
      // Check if there's work to do
      if (this.frontier.size() === 0 && this.activeWorkers === 0) {
        // Check if any jobs are still running
        const activeJobs = this.crawlRepo.getActiveJobs();
        if (activeJobs.length === 0) {
          log.info('No active jobs, stopping worker loop');
          this.running = false;
          break;
        }

        // Small delay before checking again
        await sleep(100);
        continue;
      }

      // Spawn workers up to max concurrency
      while (this.activeWorkers < this.maxWorkers && this.frontier.size() > 0) {
        const item = this.frontier.dequeueOne();
        if (!item) break;

        this.activeWorkers++;
        this.processItem(item).finally(() => {
          this.activeWorkers--;
        });
      }

      // Small delay to prevent tight loop
      await sleep(50);

      // Check if all work is done
      if (this.frontier.size() === 0 && this.activeWorkers === 0) {
        // Mark remaining running jobs as completed
        const activeJobs = this.crawlRepo.getActiveJobs();
        let allDone = true;
        for (const job of activeJobs) {
          if (job.status === JOB_STATUS.RUNNING) {
            // Check if frontier has items for this job
            allDone = true;
            this.crawlRepo.updateJobStatus(job.id, JOB_STATUS.COMPLETED);
            this.activeJobs.delete(job.id);
            log.info(`Job ${job.id} completed`);
          }
        }
        if (allDone && this.frontier.size() === 0) {
          this.running = false;
          log.info('All jobs completed, worker loop stopped');
        }
      }
    }
  }

  /**
   * Process a single frontier item: fetch, parse, index, discover links.
   */
  async processItem(item) {
    const { normalizedUrl, url, jobId, originUrl, depth } = item;

    try {
      this.scheduler.markProcessing(normalizedUrl);

      // Rate limiting
      await this.rateLimiter.acquire();
      const hostname = getHostname(normalizedUrl);
      if (hostname) {
        await this.hostDelay.waitForHost(hostname);
      }

      // Robots.txt check (best effort)
      const allowed = await this.robots.isAllowed(normalizedUrl);
      if (!allowed) {
        log.debug(`Blocked by robots.txt: ${normalizedUrl}`);
        this.scheduler.markProcessed(normalizedUrl, null, null);
        this.crawlRepo.incrementCounter(jobId, 'processed_count');
        this.crawlRepo.decrementCounter(jobId, 'queued_count');
        return;
      }

      // Fetch the page
      const { html, status, contentType } = await this.fetchPage(normalizedUrl);

      if (!html) {
        this.scheduler.markProcessed(normalizedUrl, status, contentType);
        this.crawlRepo.incrementCounter(jobId, 'processed_count');
        this.crawlRepo.decrementCounter(jobId, 'queued_count');
        return;
      }

      // Parse HTML
      const title = extractTitle(html);
      const bodyText = extractText(html);
      const links = extractLinks(html);

      // Store page and index it immediately (incremental indexing)
      const page = this.pageRepo.upsertPage(normalizedUrl, url, title, bodyText);
      this.pageRepo.addDiscovery(page.id, jobId, originUrl, depth);
      this.indexService.indexPage(page.id, normalizedUrl, title, bodyText);

      this.scheduler.markProcessed(normalizedUrl, status, contentType);
      this.crawlRepo.incrementCounter(jobId, 'processed_count');
      this.crawlRepo.incrementCounter(jobId, 'indexed_count');
      this.crawlRepo.decrementCounter(jobId, 'queued_count');

      // Discover new links if within depth limit
      const job = this.crawlRepo.getJob(jobId);
      if (depth < job.max_depth) {
        this.discoverLinks(links, normalizedUrl, jobId, originUrl, depth + 1);
      }

    } catch (err) {
      log.error(`Error processing ${normalizedUrl}: ${err.message}`);
      this.scheduler.markFailed(normalizedUrl, null, err.message);
      this.crawlRepo.incrementCounter(jobId, 'error_count');
      this.crawlRepo.incrementCounter(jobId, 'processed_count');
      this.crawlRepo.decrementCounter(jobId, 'queued_count');
    }
  }

  /**
   * Fetch a page with timeout, retries, and content-type validation.
   */
  async fetchPage(urlStr, attempt = 0) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

      const response = await fetch(urlStr, {
        signal: controller.signal,
        headers: {
          'User-Agent': config.userAgent,
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });

      clearTimeout(timeout);

      const status = response.status;
      const contentType = response.headers.get('content-type') || '';

      // Check content type
      const isHtml = HTML_CONTENT_TYPES.some(ct => contentType.toLowerCase().includes(ct));
      if (!isHtml) {
        return { html: null, status, contentType };
      }

      // Check content length
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > config.maxBodySize) {
        log.warn(`Content too large (${contentLength} bytes): ${urlStr}`);
        return { html: null, status, contentType };
      }

      const html = await response.text();

      // Truncate if body is unexpectedly large
      const truncated = html.length > config.maxBodySize
        ? html.slice(0, config.maxBodySize)
        : html;

      return { html: truncated, status, contentType };

    } catch (err) {
      if (attempt < config.maxRetries) {
        log.debug(`Retry ${attempt + 1} for ${urlStr}: ${err.message}`);
        await sleep(1000 * (attempt + 1));
        return this.fetchPage(urlStr, attempt + 1);
      }
      throw err;
    }
  }

  /**
   * Discover and schedule new links found on a page.
   */
  discoverLinks(rawLinks, sourceUrl, jobId, originUrl, newDepth) {
    const items = [];

    for (const rawHref of rawLinks) {
      const normalized = normalizeUrl(rawHref, sourceUrl);
      if (!normalized) continue;
      if (shouldSkipByExtension(normalized)) continue;

      items.push({
        normalizedUrl: normalized,
        url: rawHref.startsWith('http') ? rawHref : normalized,
        jobId,
        originUrl,
        depth: newDepth,
        discoveredFromUrl: sourceUrl,
      });
    }

    if (items.length > 0) {
      const enqueued = this.scheduler.scheduleBatch(items);
      if (enqueued > 0) {
        this.crawlRepo.incrementCounter(jobId, 'discovered_count', enqueued);
        this.crawlRepo.incrementCounter(jobId, 'queued_count', enqueued);
      }
    }
  }

  /**
   * Resume unfinished jobs after restart.
   */
  async resume() {
    this.frontier.initialize();
    const unfinished = this.crawlRepo.getUnfinishedJobs();

    if (unfinished.length === 0) {
      log.info('No jobs to resume');
      return;
    }

    log.info(`Resuming ${unfinished.length} unfinished jobs`);
    for (const job of unfinished) {
      this.activeJobs.set(job.id, {
        originUrl: job.origin_url,
        maxDepth: job.max_depth,
        startedAt: Date.now(),
      });
      this.crawlRepo.updateJobStatus(job.id, JOB_STATUS.RUNNING);
    }

    if (this.frontier.size() > 0 && !this.running) {
      this.running = true;
      this.runWorkerLoop();
    }
  }

  /**
   * Get current operational status.
   */
  getStatus() {
    const queueStats = this.frontier.getStats();
    const activeJobs = this.crawlRepo.getActiveJobs();

    return {
      activeJobs: activeJobs.length,
      queueDepth: queueStats.currentSize,
      maxQueueDepth: queueStats.maxDepth,
      activeWorkers: this.activeWorkers,
      maxWorkers: this.maxWorkers,
      throttled: this.throttled,
      queueSaturated: queueStats.saturated,
      droppedUrls: queueStats.droppedCount,
      running: this.running,
    };
  }

  /**
   * Stop the crawler gracefully.
   */
  stop() {
    this.running = false;
    log.info('Crawler stopped');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Singleton instance
let instance = null;
export function getCrawlerService() {
  if (!instance) {
    instance = new CrawlerService();
  }
  return instance;
}
