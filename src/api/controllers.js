import { getCrawlerService } from '../crawler/crawlerService.js';
import { IndexService } from '../indexer/indexService.js';
import { CrawlRepository } from '../storage/crawlRepository.js';
import { StateRepository } from '../storage/stateRepository.js';
import { PageRepository } from '../storage/pageRepository.js';
import { IndexRepository } from '../storage/indexRepository.js';
import { tokenize } from '../indexer/tokenizer.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('api');
const indexService = new IndexService();
const crawlRepo = new CrawlRepository();
const stateRepo = new StateRepository();
const pageRepo = new PageRepository();
const indexRepo = new IndexRepository();

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

/**
 * GET /search?query=<word>&sortBy=relevance
 * Legacy/compatible search endpoint matching reference project format.
 *
 * Scoring formula: score = (frequency x 10) + 1000 (exact match bonus) - (depth x 5)
 * Returns results sorted by relevance_score descending with pagination.
 */
export async function searchLegacy(query, sortBy, page = 1, limit = 20) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { status: 400, body: { error: 'Missing or empty "query" parameter' } };
  }

  try {
    const queryStr = query.trim().toLowerCase();
    const queryTokens = tokenize(queryStr);
    if (queryTokens.length === 0) {
      return { status: 200, body: { query, results: [], total: 0, page, limit } };
    }

    const { getDb } = await import('../storage/db.js');
    const db = getDb();

    // Find all matching terms with their page data and discovery info
    const placeholders = queryTokens.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT
        pt.term,
        pt.frequency,
        pt.field,
        p.url,
        p.title,
        pd.origin_url,
        pd.depth
      FROM page_terms pt
      JOIN pages p ON p.id = pt.page_id
      JOIN page_discoveries pd ON pd.page_id = p.id
      WHERE pt.term IN (${placeholders})
      ORDER BY pt.frequency DESC
    `).all(...queryTokens);

    if (rows.length === 0) {
      return { status: 200, body: { query, results: [], total: 0, page, limit } };
    }

    // Group by (url, origin_url, depth) and aggregate scores
    const resultMap = new Map();
    for (const row of rows) {
      const key = `${row.url}|${row.origin_url}|${row.depth}`;
      if (!resultMap.has(key)) {
        resultMap.set(key, {
          url: row.url,
          title: row.title,
          origin_url: row.origin_url,
          depth: row.depth,
          totalFrequency: 0,
          exactMatch: false,
          terms: [],
        });
      }
      const entry = resultMap.get(key);
      entry.totalFrequency += row.frequency;
      entry.terms.push({ term: row.term, field: row.field, frequency: row.frequency });

      // Check if any query token is an exact match
      if (queryTokens.includes(row.term)) {
        entry.exactMatch = true;
      }
    }

    // Calculate scores using the reference formula:
    // score = (frequency x 10) + 1000 (exact match bonus) - (depth x 5)
    const results = [];
    for (const entry of resultMap.values()) {
      const frequencyScore = entry.totalFrequency * 10;
      const exactMatchBonus = entry.exactMatch ? 1000 : 0;
      const depthPenalty = entry.depth * 5;
      const relevance_score = frequencyScore + exactMatchBonus - depthPenalty;

      results.push({
        url: entry.url,
        title: entry.title,
        origin_url: entry.origin_url,
        depth: entry.depth,
        frequency: entry.totalFrequency,
        relevance_score,
        terms: entry.terms,
      });
    }

    // Sort by relevance_score descending
    if (sortBy === 'relevance') {
      results.sort((a, b) => b.relevance_score - a.relevance_score);
    } else {
      results.sort((a, b) => b.frequency - a.frequency);
    }

    // Pagination
    const total = results.length;
    const offset = (page - 1) * limit;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      status: 200,
      body: {
        query,
        results: paginatedResults,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (err) {
    log.error('Legacy search failed', err.message);
    return { status: 500, body: { error: err.message } };
  }
}

/**
 * DELETE /api/jobs/:id
 * Deletes a job and all associated data (discovered URLs, pages, index terms).
 * Running jobs are cancelled first.
 */
export function deleteJob(id) {
  try {
    const jobId = parseInt(id, 10);
    const job = crawlRepo.getJob(jobId);
    if (!job) {
      return { status: 404, body: { error: 'Job not found' } };
    }

    // If job is still running or paused, cancel it first
    if (job.status === 'running' || job.status === 'paused') {
      const crawler = getCrawlerService();
      try { crawler.cancelJob(jobId); } catch { /* already stopped */ }
    }

    const deleted = crawlRepo.deleteJob(jobId);
    log.info(`Job ${jobId} deleted`);
    return { status: 200, body: { deleted: true, jobId, origin: deleted.origin_url } };
  } catch (err) {
    log.error('Delete job failed', err.message);
    return { status: 500, body: { error: err.message } };
  }
}
