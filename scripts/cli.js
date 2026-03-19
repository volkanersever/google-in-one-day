/**
 * CLI interface for indexing and searching.
 * Usage:
 *   npm run index -- https://example.com 2
 *   npm run search -- "node crawler"
 *   npm run status
 */
import { initializeSchema, closeDb } from '../src/storage/db.js';
import { CrawlRepository } from '../src/storage/crawlRepository.js';
import { IndexService } from '../src/indexer/indexService.js';
import { StateRepository } from '../src/storage/stateRepository.js';
import { PageRepository } from '../src/storage/pageRepository.js';

initializeSchema();

const command = process.argv[2];
const args = process.argv.slice(3);

try {
  switch (command) {
    case 'index': {
      const origin = args[0];
      const depth = parseInt(args[1] || '2', 10);
      if (!origin) {
        console.error('Usage: npm run index -- <url> <depth>');
        process.exit(1);
      }
      console.log(`To start indexing, use the web UI or API:`);
      console.log(`  curl -X POST http://localhost:3000/api/index \\`);
      console.log(`    -H "Content-Type: application/json" \\`);
      console.log(`    -d '{"origin": "${origin}", "k": ${depth}}'`);
      break;
    }

    case 'search': {
      const query = args.join(' ');
      if (!query) {
        console.error('Usage: npm run search -- "query"');
        process.exit(1);
      }
      const indexService = new IndexService();
      const results = indexService.search(query);
      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`Found ${results.length} results:\n`);
        for (const r of results.slice(0, 20)) {
          console.log(`  [${r.score}] ${r.relevant_url}`);
          console.log(`         origin: ${r.origin_url}  depth: ${r.depth}`);
          if (r.title) console.log(`         title: ${r.title}`);
          console.log();
        }
      }
      break;
    }

    case 'status': {
      const crawlRepo = new CrawlRepository();
      const stateRepo = new StateRepository();
      const pageRepo = new PageRepository();

      const jobs = crawlRepo.getAllJobs();
      const pageCount = pageRepo.getPageCount();
      const urlStats = stateRepo.getDiscoveredUrlStats();
      const frontierCount = stateRepo.getFrontierCount();

      console.log('=== System Status ===\n');
      console.log(`Pages indexed: ${pageCount}`);
      console.log(`Frontier queue: ${frontierCount}`);
      console.log(`URL states:`);
      for (const s of urlStats) {
        console.log(`  ${s.state}: ${s.count}`);
      }
      console.log(`\nJobs (${jobs.length} total):`);
      for (const j of jobs) {
        console.log(`  #${j.id} [${j.status}] ${j.origin_url} (depth: ${j.max_depth})`);
        console.log(`    discovered: ${j.discovered_count} | processed: ${j.processed_count} | indexed: ${j.indexed_count} | errors: ${j.error_count}`);
      }
      break;
    }

    default:
      console.log('Commands: index, search, status');
      console.log('  npm run index -- <url> <depth>');
      console.log('  npm run search -- "query"');
      console.log('  npm run status');
  }
} finally {
  closeDb();
}
