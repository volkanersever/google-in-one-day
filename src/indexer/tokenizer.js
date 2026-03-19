/**
 * Simple text tokenizer for search indexing.
 * Splits on non-alphanumeric, lowercases, removes stopwords, stems naively.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'was', 'were',
  'are', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our',
  'their', 'not', 'no', 'so', 'if', 'up', 'out', 'about', 'into',
  'than', 'then', 'just', 'all', 'also', 'how', 'what', 'when', 'where',
  'who', 'which', 'why', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very',
]);

/**
 * Tokenize text into an array of normalized tokens.
 */
export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Compute term frequencies from a token array.
 * Returns Map<term, frequency>.
 */
export function termFrequencies(tokens) {
  const freq = new Map();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}

/**
 * Tokenize a URL into meaningful tokens.
 * Splits path and query on common delimiters.
 */
export function tokenizeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const parts = [
      url.hostname,
      ...url.pathname.split(/[/\-_.]+/),
      ...url.search.split(/[&=?]/),
    ];
    return parts
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 2 && !STOPWORDS.has(t));
  } catch {
    return [];
  }
}
