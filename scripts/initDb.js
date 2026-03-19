/**
 * Initialize the database schema.
 * Run: npm run init-db
 */
import { initializeSchema, closeDb } from '../src/storage/db.js';
import { createLogger } from '../src/shared/logger.js';

const log = createLogger('init-db');

try {
  initializeSchema();
  log.info('Database schema initialized successfully.');
  log.info('You can now start the server with: npm run dev');
} catch (err) {
  log.error('Failed to initialize database:', err.message);
  process.exit(1);
} finally {
  closeDb();
}
