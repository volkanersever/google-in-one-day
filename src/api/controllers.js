import { getCrawlerService } from '../crawler/crawlerService.js';
import { IndexService } from '../indexer/indexService.js';
import { CrawlRepository } from '../storage/crawlRepository.js';
import { StateRepository } from '../storage/stateRepository.js';
import { PageRepository } from '../storage/pageRepository.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('api');
const indexService = new IndexService();
const crawlRepo = new CrawlRepository();
const stateRepo = new StateRepository();
const pageRepo = new PageRepository();

/**
 * POST /api/index
 * Body: { "origin": "https://example.com", "k": 2 }
 */
export async function startIndex(body) {
  const { origin, k } = body;

  if (!origin || typeof origin !== 'string') {
    return { status: 400, body: { error: 'Missing or invalid "origin" URL' } };
  }
  if (k === undefined || typeof k !== 'number' || k < 0) {
    return { status: 400, body: { error: 'Missing or invalid "k" (depth), must be >= 0' } };
  }

  try {
    const crawler = getCrawlerService();
    const job = await crawler.startJob(origin, k);
    return {
      status: 200,
      body: {
        jobId: job.id,
        origin: job.origin_url,
        maxDepth: job.max_depth,
        status: job.status,
      },
    };
  } catch (err) {
    log.error('Failed to start index', err.message);
    return { status: 500, body: { error: err.message } };
  }
}

/**
 * GET /api/search?q=query
 */
export function search(query) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { status: 400, body: { error: 'Missing or empty "q" parameter' } };
  }

  try {
    const results = indexService.search(query.trim());
    return { status: 200, body: results };
  } catch (err) {
    log.error('Search failed', err.message);
    return { status: 500, body: { error: err.message } };
  }
}

/**
 * GET /api/status
 */
export function getStatus() {
  try {
    const crawler = getCrawlerService();
    const crawlerStatus = crawler.getStatus();
    const pageCount = pageRepo.getPageCount();
    const recentErrors = stateRepo.getRecentErrors(5);
    const urlStats = stateRepo.getDiscoveredUrlStats();

    const statsMap = {};
    for (const s of urlStats) {
      statsMap[s.state] = s.count;
    }

    return {
      status: 200,
      body: {
        ...crawlerStatus,
        processedCount: statsMap.processed || 0,
        indexedCount: pageCount,
        errorCount: statsMap.failed || 0,
        skippedCount: statsMap.skipped || 0,
        recentErrors,
      },
    };
  } catch (err) {
    log.error('Status failed', err.message);
    return { status: 500, body: { error: err.message } };
  }
}

/**
 * GET /api/jobs
 */
export function getJobs() {
  try {
    const jobs = crawlRepo.getAllJobs();
    return { status: 200, body: jobs };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}

/**
 * GET /api/jobs/:id
 */
export function getJob(id) {
  try {
    const job = crawlRepo.getJob(parseInt(id, 10));
    if (!job) {
      return { status: 404, body: { error: 'Job not found' } };
    }
    return { status: 200, body: job };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}

/**
 * POST /api/jobs/:id/pause
 */
export function pauseJob(id) {
  try {
    const crawler = getCrawlerService();
    const job = crawler.pauseJob(parseInt(id, 10));
    return { status: 200, body: job };
  } catch (err) {
    log.error('Pause job failed', err.message);
    const status = err.message.includes('not found') ? 404 : 400;
    return { status, body: { error: err.message } };
  }
}

/**
 * POST /api/jobs/:id/resume
 */
export async function resumeJob(id) {
  try {
    const crawler = getCrawlerService();
    const job = await crawler.resumeJob(parseInt(id, 10));
    return { status: 200, body: job };
  } catch (err) {
    log.error('Resume job failed', err.message);
    const status = err.message.includes('not found') ? 404 : 400;
    return { status, body: { error: err.message } };
  }
}

/**
 * POST /api/jobs/:id/cancel
 */
export function cancelJob(id) {
  try {
    const crawler = getCrawlerService();
    const job = crawler.cancelJob(parseInt(id, 10));
    return { status: 200, body: job };
  } catch (err) {
    log.error('Cancel job failed', err.message);
    const status = err.message.includes('not found') ? 404 : 400;
    return { status, body: { error: err.message } };
  }
}
