import { tokenize, tokenizeUrl } from './tokenizer.js';

/**
 * Score a page against a search query.
 *
 * Scoring heuristic:
 * - Title exact token match: +5 per token
 * - Body token match: +1 * log(1 + tf) per token
 * - URL token match: +2 per token
 * - Phrase substring bonus: +10 if raw query appears in title, +3 if in body
 */
export function scorePage(query, page, termMatches) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  let score = 0;
  const queryLower = query.toLowerCase().trim();

  // Score from term matches (pre-computed from DB)
  for (const match of termMatches) {
    if (match.field === 'title') {
      score += 5 * match.frequency;
    } else if (match.field === 'body') {
      score += 1 * Math.log(1 + match.frequency);
    } else if (match.field === 'url') {
      score += 2 * match.frequency;
    }
  }

  // Phrase substring bonus
  if (page.title && page.title.toLowerCase().includes(queryLower)) {
    score += 10;
  }
  if (page.body_text && page.body_text.toLowerCase().includes(queryLower)) {
    score += 3;
  }

  return Math.round(score * 100) / 100;
}

/**
 * Rank search results by score descending.
 * Returns only results with score > 0.
 */
export function rankResults(results) {
  return results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
