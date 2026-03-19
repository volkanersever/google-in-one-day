import { getDb } from '../storage/db.js';
import { createLogger } from '../shared/logger.js';
import { config } from '../shared/config.js';

const log = createLogger('frontier');

/**
 * Bounded frontier queue backed by SQLite for persistence/resume.
 * Implements back pressure: rejects enqueue when at capacity.
 *
 * Uses an in-memory buffer for fast dequeue, refilled from DB.
 */
export class FrontierQueue {
  constructor() {
    this.maxDepth = config.maxQueueDepth;
    this.currentSize = 0;
    this.saturated = false;
    this.droppedCount = 0;
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) return;
    const db = getDb();
    this.currentSize = db.prepare('SELECT COUNT(*) as c FROM frontier_queue').get().c;
    this.saturated = this.currentSize >= this.maxDepth;
    this._initialized = true;
    log.info(`Frontier initialized with ${this.currentSize} items (max: ${this.maxDepth})`);
  }

  /**
   * Enqueue a URL. Returns true if enqueued, false if dropped due to back pressure.
   */
  enqueue(item) {
    this.initialize();
    if (this.currentSize >= this.maxDepth) {
      this.saturated = true;
      this.droppedCount++;
      return false;
    }

    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO frontier_queue (normalized_url, url, job_id, origin_url, depth, discovered_from_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(item.normalizedUrl, item.url, item.jobId, item.originUrl, item.depth, item.discoveredFromUrl || null);

      this.currentSize++;
      this.saturated = this.currentSize >= this.maxDepth;
      return true;
    } catch (err) {
      log.error('Failed to enqueue', err.message);
      return false;
    }
  }

  /**
   * Enqueue multiple items in a transaction. Returns count of successfully enqueued.
   */
  enqueueBatch(items) {
    this.initialize();
    const db = getDb();
    let enqueued = 0;

    const insert = db.prepare(`
      INSERT INTO frontier_queue (normalized_url, url, job_id, origin_url, depth, discovered_from_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const item of items) {
        if (this.currentSize >= this.maxDepth) {
          this.saturated = true;
          this.droppedCount += items.length - enqueued;
          break;
        }
        try {
          insert.run(item.normalizedUrl, item.url, item.jobId, item.originUrl, item.depth, item.discoveredFromUrl || null);
          this.currentSize++;
          enqueued++;
        } catch {
          // Skip duplicates
        }
      }
    });

    tx();
    this.saturated = this.currentSize >= this.maxDepth;
    return enqueued;
  }

  /**
   * Dequeue a batch of items for processing.
   */
  dequeue(count = 1) {
    this.initialize();
    const db = getDb();

    const items = db.prepare(`
      SELECT * FROM frontier_queue ORDER BY id ASC LIMIT ?
    `).all(count);

    if (items.length > 0) {
      const ids = items.map(i => i.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM frontier_queue WHERE id IN (${placeholders})`).run(...ids);
      this.currentSize = Math.max(0, this.currentSize - items.length);
      this.saturated = this.currentSize >= this.maxDepth;
    }

    return items.map(row => ({
      normalizedUrl: row.normalized_url,
      url: row.url,
      jobId: row.job_id,
      originUrl: row.origin_url,
      depth: row.depth,
      discoveredFromUrl: row.discovered_from_url,
    }));
  }

  /**
   * Dequeue one item.
   */
  dequeueOne() {
    const items = this.dequeue(1);
    return items.length > 0 ? items[0] : null;
  }

  size() {
    this.initialize();
    return this.currentSize;
  }

  isSaturated() {
    return this.saturated;
  }

  getStats() {
    return {
      currentSize: this.currentSize,
      maxDepth: this.maxDepth,
      saturated: this.saturated,
      droppedCount: this.droppedCount,
    };
  }

  /**
   * Clear all frontier items for a specific job.
   */
  clearJob(jobId) {
    const db = getDb();
    const result = db.prepare('DELETE FROM frontier_queue WHERE job_id = ?').run(jobId);
    this.currentSize = Math.max(0, this.currentSize - result.changes);
    this.saturated = this.currentSize >= this.maxDepth;
  }
}
