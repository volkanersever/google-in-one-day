import { getDb } from './db.js';

export class PageRepository {
  upsertPage(normalizedUrl, url, title, bodyText) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO pages (normalized_url, url, title, body_text, content_length)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(normalized_url) DO UPDATE SET
        title = excluded.title,
        body_text = excluded.body_text,
        content_length = excluded.content_length,
        fetched_at = datetime('now')
    `);
    stmt.run(normalizedUrl, url, title, bodyText, (bodyText || '').length);

    return db.prepare('SELECT * FROM pages WHERE normalized_url = ?').get(normalizedUrl);
  }

  getPageByUrl(normalizedUrl) {
    const db = getDb();
    return db.prepare('SELECT * FROM pages WHERE normalized_url = ?').get(normalizedUrl);
  }

  getPageCount() {
    const db = getDb();
    return db.prepare('SELECT COUNT(*) as count FROM pages').get().count;
  }

  addDiscovery(pageId, jobId, originUrl, depth) {
    const db = getDb();
    try {
      db.prepare(`
        INSERT OR IGNORE INTO page_discoveries (page_id, job_id, origin_url, depth)
        VALUES (?, ?, ?, ?)
      `).run(pageId, jobId, originUrl, depth);
    } catch {
      // Ignore duplicate discovery records
    }
  }
}
