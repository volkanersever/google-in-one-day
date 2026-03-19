import { tokenize, termFrequencies, tokenizeUrl } from './tokenizer.js';
import { scorePage, rankResults } from './relevance.js';
import { IndexRepository } from '../storage/indexRepository.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('indexer');

/**
 * Manages indexing of pages and search queries.
 * Indexing is incremental: each page becomes searchable immediately after commit.
 */
export class IndexService {
  constructor() {
    this.indexRepo = new IndexRepository();
  }

  /**
   * Index a page: tokenize title, body, and URL, then store term frequencies.
   * Called immediately after fetching/parsing for incremental visibility.
   */
  indexPage(pageId, normalizedUrl, title, bodyText) {
    const terms = [];

    // Tokenize and count title terms
    const titleTokens = tokenize(title);
    const titleFreq = termFrequencies(titleTokens);
    for (const [term, freq] of titleFreq) {
      terms.push({ term, field: 'title', frequency: freq });
    }

    // Tokenize and count body terms
    const bodyTokens = tokenize(bodyText);
    const bodyFreq = termFrequencies(bodyTokens);
    for (const [term, freq] of bodyFreq) {
      terms.push({ term, field: 'body', frequency: freq });
    }

    // Tokenize URL
    const urlTokens = tokenizeUrl(normalizedUrl);
    const urlFreq = termFrequencies(urlTokens);
    for (const [term, freq] of urlFreq) {
      terms.push({ term, field: 'url', frequency: freq });
    }

    // Commit to DB (synchronous — immediately visible to search)
    this.indexRepo.indexPage(pageId, terms);
    log.debug(`Indexed page ${pageId} (${terms.length} terms)`);
  }

  /**
   * Search the index for pages matching the query.
   * Returns results as triples: (relevant_url, origin_url, depth, score)
   */
  search(query) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // Find all term matches
    const rawMatches = this.indexRepo.searchTerms(queryTokens);
    if (rawMatches.length === 0) return [];

    // Group matches by page_id
    const pageMatches = new Map();
    const pageData = new Map();

    for (const match of rawMatches) {
      const pid = match.page_id;
      if (!pageMatches.has(pid)) {
        pageMatches.set(pid, []);
        pageData.set(pid, {
          normalized_url: match.normalized_url,
          url: match.url,
          title: match.title,
          body_text: match.body_text,
        });
      }
      pageMatches.get(pid).push({
        field: match.field,
        frequency: match.frequency,
        term: match.term,
      });
    }

    // Score each page
    const scored = [];
    for (const [pageId, matches] of pageMatches) {
      const page = pageData.get(pageId);
      const score = scorePage(query, page, matches);
      if (score > 0) {
        scored.push({ pageId, score, page });
      }
    }

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Get discovery metadata for all matched pages
    const pageIds = scored.map(s => s.pageId);
    const discoveries = this.indexRepo.getDiscoveries(pageIds);

    // Build result triples
    const results = [];
    for (const { pageId, score, page } of scored) {
      const pageDiscoveries = discoveries.filter(d => d.page_id === pageId);
      if (pageDiscoveries.length === 0) {
        // Page exists but no discovery record yet (edge case)
        results.push({
          relevant_url: page.url,
          origin_url: page.url,
          depth: 0,
          score,
          title: page.title,
        });
      } else {
        for (const disc of pageDiscoveries) {
          results.push({
            relevant_url: page.url,
            origin_url: disc.origin_url,
            depth: disc.depth,
            score,
            title: page.title,
          });
        }
      }
    }

    return results;
  }
}
