import { getDb } from './db.js';
import { JOB_STATUS } from '../shared/constants.js';

export class CrawlRepository {
  createJob(originUrl, maxDepth) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO crawl_jobs (origin_url, max_depth, status)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(originUrl, maxDepth, JOB_STATUS.QUEUED);
    return this.getJob(result.lastInsertRowid);
  }

  getJob(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM crawl_jobs WHERE id = ?').get(id);
  }

  getAllJobs() {
    const db = getDb();
    return db.prepare('SELECT * FROM crawl_jobs ORDER BY created_at DESC').all();
  }

  getActiveJobs() {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM crawl_jobs WHERE status IN (?, ?) ORDER BY created_at DESC'
    ).all(JOB_STATUS.QUEUED, JOB_STATUS.RUNNING);
  }

  updateJobStatus(id, status) {
    const db = getDb();
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === JOB_STATUS.RUNNING) {
      updates.started_at = new Date().toISOString();
    }
    const setClauses = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE crawl_jobs SET ${setClauses} WHERE id = @id`).run({ ...updates, id });
  }

  incrementCounter(id, counter, amount = 1) {
    const db = getDb();
    db.prepare(`
      UPDATE crawl_jobs SET ${counter} = ${counter} + ?, updated_at = datetime('now') WHERE id = ?
    `).run(amount, id);
  }

  decrementCounter(id, counter, amount = 1) {
    const db = getDb();
    db.prepare(`
      UPDATE crawl_jobs SET ${counter} = MAX(0, ${counter} - ?), updated_at = datetime('now') WHERE id = ?
    `).run(amount, id);
  }

  getUnfinishedJobs() {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM crawl_jobs WHERE status IN (?, ?)'
    ).all(JOB_STATUS.QUEUED, JOB_STATUS.RUNNING);
  }

  /**
   * Delete a job and all its associated data (discovered URLs, frontier items,
   * page discoveries, page terms, and orphaned pages).
   */
  deleteJob(id) {
    const db = getDb();
    const job = this.getJob(id);
    if (!job) return null;

    const deleteAll = db.transaction(() => {
      // 1. Delete frontier queue items for this job
      db.prepare('DELETE FROM frontier_queue WHERE job_id = ?').run(id);

      // 2. Find page_ids discovered only by this job (orphaned after deletion)
      const exclusivePages = db.prepare(`
        SELECT pd.page_id FROM page_discoveries pd
        WHERE pd.job_id = ?
        AND pd.page_id NOT IN (
          SELECT page_id FROM page_discoveries WHERE job_id != ?
        )
      `).all(id, id);

      const exclusivePageIds = exclusivePages.map(r => r.page_id);

      // 3. Delete page discoveries for this job
      db.prepare('DELETE FROM page_discoveries WHERE job_id = ?').run(id);

      // 4. Delete orphaned page terms and pages
      if (exclusivePageIds.length > 0) {
        const placeholders = exclusivePageIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM page_terms WHERE page_id IN (${placeholders})`).run(...exclusivePageIds);
        db.prepare(`DELETE FROM pages WHERE id IN (${placeholders})`).run(...exclusivePageIds);
      }

      // 5. Delete discovered URLs for this job
      db.prepare('DELETE FROM discovered_urls WHERE job_id = ?').run(id);

      // 6. Delete the job itself
      db.prepare('DELETE FROM crawl_jobs WHERE id = ?').run(id);
    });

    deleteAll();
    return job;
  }
}
