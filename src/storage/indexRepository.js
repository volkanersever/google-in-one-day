import { getDb } from './db.js';

export class IndexRepository {
  /**
   * Replace all terms for a page (delete old, insert new).
   * Called within a transaction by the index service.
   */
  indexPage(pageId, terms) {
    const db = getDb();
    const deletePrev = db.prepare('DELETE FROM page_terms WHERE page_id = ?');
    const insert = db.prepare(`
      INSERT INTO page_terms (page_id, term, field, frequency)
      VALUES (?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      deletePrev.run(pageId);
      for (const { term, field, frequency } of terms) {
        insert.run(pageId, term, field, frequency);
      }
    });

    tx();
  }

  /**
   * Search for pages matching any of the given terms.
   * Returns raw matches with term info for scoring in the application layer.
   */
  searchTerms(terms) {
    const db = getDb();
    if (terms.length === 0) return [];

    const placeholders = terms.map(() => '?').join(',');
    return db.prepare(`
      SELECT
        pt.page_id,
        pt.term,
        pt.field,
        pt.frequency,
        p.normalized_url,
        p.url,
        p.title,
        p.body_text
      FROM page_terms pt
      JOIN pages p ON p.id = pt.page_id
      WHERE pt.term IN (${placeholders})
    `).all(...terms);
  }

  /**
   * Get all discovery records for a set of page IDs.
   */
  getDiscoveries(pageIds) {
    const db = getDb();
    if (pageIds.length === 0) return [];

    const placeholders = pageIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT * FROM page_discoveries
      WHERE page_id IN (${placeholders})
    `).all(...pageIds);
  }
}
