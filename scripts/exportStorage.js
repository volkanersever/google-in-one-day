/**
 * Export indexed data from SQLite into file-based storage format.
 * Creates data/storage/[letter].data files where each line is:
 *   word url origin depth frequency
 *
 * Usage: npm run export-storage
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeSchema, getDb, closeDb } from '../src/storage/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const storageDir = resolve(__dirname, '..', 'data', 'storage');

initializeSchema();
const db = getDb();

// Ensure storage directory exists
mkdirSync(storageDir, { recursive: true });

console.log('Exporting indexed data to data/storage/...');

// Query all term entries with discovery metadata
// Each row: term, field, frequency, url, origin_url, depth
const rows = db.prepare(`
  SELECT
    pt.term,
    pt.field,
    pt.frequency,
    p.url,
    pd.origin_url,
    pd.depth
  FROM page_terms pt
  JOIN pages p ON pt.page_id = p.id
  JOIN page_discoveries pd ON pd.page_id = p.id
  ORDER BY pt.term, pt.frequency DESC
`).all();

console.log(`Found ${rows.length} term entries to export.`);

// Group by first letter
const letterGroups = new Map();

for (const row of rows) {
  const term = row.term.toLowerCase();
  if (!term || term.length === 0) continue;

  const firstChar = term[0];
  // Only group by letters and digits
  const key = /[a-z]/.test(firstChar) ? firstChar : /[0-9]/.test(firstChar) ? firstChar : '_';

  if (!letterGroups.has(key)) {
    letterGroups.set(key, []);
  }

  // Format: word url origin depth frequency
  letterGroups.get(key).push(
    `${term}\t${row.url}\t${row.origin_url}\t${row.depth}\t${row.frequency}`
  );
}

// Write each letter file
let totalFiles = 0;
let totalLines = 0;

for (const [letter, lines] of letterGroups) {
  const filePath = resolve(storageDir, `${letter}.data`);
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  totalFiles++;
  totalLines += lines.length;
  console.log(`  ${letter}.data — ${lines.length} entries`);
}

console.log(`\nExport complete: ${totalFiles} files, ${totalLines} total entries.`);
console.log(`Storage directory: ${storageDir}`);

closeDb();
