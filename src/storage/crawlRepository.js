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
}
