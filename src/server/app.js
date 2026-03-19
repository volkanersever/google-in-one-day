import { createServer } from 'node:http';
import { config } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';
import { initializeSchema, closeDb } from '../storage/db.js';
import { handleRequest } from './routes.js';
import { getCrawlerService } from '../crawler/crawlerService.js';

const log = createLogger('app');

async function main() {
  // Initialize database schema
  initializeSchema();
  log.info('Database initialized');

  // Resume any unfinished crawl jobs
  const crawler = getCrawlerService();
  await crawler.resume();

  // Create and start HTTP server
  const server = createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      log.error('Unhandled request error', err.message);
      res.writeHead(500);
      res.end('Internal Server Error');
    });
  });

  server.listen(config.port, () => {
    log.info(`Server running at http://localhost:${config.port}`);
    log.info(`Dashboard: http://localhost:${config.port}/`);
    log.info(`API: http://localhost:${config.port}/api/status`);
  });

  // Graceful shutdown
  const shutdown = () => {
    log.info('Shutting down...');
    crawler.stop();
    server.close(() => {
      closeDb();
      log.info('Server stopped');
      process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
