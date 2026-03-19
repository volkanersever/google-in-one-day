import { getDb } from './db.js';

export class StateRepository {
  get(key) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_state WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  set(key, value) {
    const db = getDb();
    db.prepare(`
      INSERT INTO system_state (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  getAll() {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM system_state').all();
    const result = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  getDiscoveredUrlStats() {
    const db = getDb();
    return db.prepare(`
      SELECT state, COUNT(*) as count FROM discovered_urls GROUP BY state
    `).all();
  }

  getFrontierCount() {
    const db = getDb();
    return db.prepare('SELECT COUNT(*) as count FROM frontier_queue').get().count;
  }

  getRecentErrors(limit = 10) {
    const db = getDb();
    return db.prepare(`
      SELECT normalized_url, error_message, http_status, fetched_at
      FROM discovered_urls
      WHERE state = 'failed'
      ORDER BY fetched_at DESC
      LIMIT ?
    `).all(limit);
  }
}
