import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('db');
const __dirname = dirname(fileURLToPath(import.meta.url));

let db = null;

export function getDb() {
  if (db) return db;

  const dbPath = resolve(config.dbPath);
  const dbDir = dirname(dbPath);
  mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  log.info(`Database opened at ${dbPath}`);
  return db;
}

export function initializeSchema() {
  const d = getDb();
  const schemaPath = resolve(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Execute the entire schema at once
  d.exec(schema);

  log.info('Schema initialized');
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    log.info('Database closed');
  }
}
