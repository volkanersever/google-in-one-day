import { createLogger } from '../shared/logger.js';
import { config } from '../shared/config.js';
import { getDb } from '../storage/db.js';
import { URL_STATE } from '../shared/constants.js';

const log = createLogger('scheduler');

/**
 * Controls admission to the frontier.
 * Deduplicates URLs globally using the discovered_urls table.
 * A URL is only fetched once across all jobs.
 */
export class Scheduler {
  constructor(frontierQueue) {
    this.frontier = frontierQueue;
  }

  /**
   * Attempt to schedule a URL for crawling.
   * Returns true if the URL was enqueued (new URL), false if already seen or dropped.
   */
  schedule(item) {
    const db = getDb();

    // Check if already discovered globally
    const existing = db.prepare(
      'SELECT id, state FROM discovered_urls WHERE normalized_url = ?'
    ).get(item.normalizedUrl);

    if (existing) {
      // Already discovered — skip fetch but still record discovery metadata later
      return { enqueued: false, reason: 'already_seen' };
    }

    // Register in discovered_urls as queued
    try {
      db.prepare(`
        INSERT INTO discovered_urls (normalized_url, url, state, depth, job_id, discovered_from_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(item.normalizedUrl, item.url, URL_STATE.QUEUED, item.depth, item.jobId, item.discoveredFromUrl || null);
    } catch (err) {
      // UNIQUE constraint violation — race condition guard
      if (err.message.includes('UNIQUE')) {
        return { enqueued: false, reason: 'already_seen' };
      }
      throw err;
    }

    // Try to enqueue in frontier
    const enqueued = this.frontier.enqueue(item);
    if (!enqueued) {
      // Back pressure — update state to skipped
      db.prepare(
        "UPDATE discovered_urls SET state = ? WHERE normalized_url = ?"
      ).run(URL_STATE.SKIPPED, item.normalizedUrl);
      return { enqueued: false, reason: 'back_pressure' };
    }

    return { enqueued: true };
  }

  /**
   * Schedule a batch of URLs. Returns count enqueued.
   */
  scheduleBatch(items) {
    const db = getDb();
    let enqueued = 0;
    const toEnqueue = [];

    const checkStmt = db.prepare('SELECT id FROM discovered_urls WHERE normalized_url = ?');
    const insertStmt = db.prepare(`
      INSERT INTO discovered_urls (normalized_url, url, state, depth, job_id, discovered_from_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const filterTx = db.transaction(() => {
      for (const item of items) {
        const existing = checkStmt.get(item.normalizedUrl);
        if (existing) continue;

        try {
          insertStmt.run(item.normalizedUrl, item.url, URL_STATE.QUEUED, item.depth, item.jobId, item.discoveredFromUrl || null);
          toEnqueue.push(item);
        } catch (err) {
          if (!err.message.includes('UNIQUE')) throw err;
        }
      }
    });

    filterTx();

    if (toEnqueue.length > 0) {
      enqueued = this.frontier.enqueueBatch(toEnqueue);
    }

    return enqueued;
  }

  /**
   * Mark a URL as being processed.
   */
  markProcessing(normalizedUrl) {
    const db = getDb();
    db.prepare(
      "UPDATE discovered_urls SET state = ? WHERE normalized_url = ?"
    ).run(URL_STATE.PROCESSING, normalizedUrl);
  }

  /**
   * Mark a URL as successfully processed.
   */
  markProcessed(normalizedUrl, httpStatus, contentType) {
    const db = getDb();
    db.prepare(`
      UPDATE discovered_urls SET state = ?, http_status = ?, content_type = ?, fetched_at = datetime('now')
      WHERE normalized_url = ?
    `).run(URL_STATE.PROCESSED, httpStatus, contentType, normalizedUrl);
  }

  /**
   * Mark a URL as failed.
   */
  markFailed(normalizedUrl, httpStatus, errorMessage) {
    const db = getDb();
    db.prepare(`
      UPDATE discovered_urls SET state = ?, http_status = ?, error_message = ?, fetched_at = datetime('now')
      WHERE normalized_url = ?
    `).run(URL_STATE.FAILED, httpStatus, errorMessage, normalizedUrl);
  }
}
