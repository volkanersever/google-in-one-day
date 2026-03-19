/**
 * Lightweight HTML parser using regex.
 * Not browser-perfect, but good enough for crawling assignment scope.
 */

/**
 * Extract the page title from HTML.
 */
export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return decodeEntities(match[1]).trim().slice(0, 500);
}

/**
 * Extract anchor href links from HTML.
 * Returns an array of raw href strings (not yet resolved/normalized).
 */
export function extractLinks(html) {
  const links = [];
  const seen = new Set();
  const regex = /<a\s[^>]*href\s*=\s*["']([^"']*?)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1].trim();
    if (href && !seen.has(href)) {
      seen.add(href);
      links.push(href);
    }
  }
  return links;
}

/**
 * Extract visible text from HTML.
 * Strips scripts, styles, noscript, and HTML tags.
 */
export function extractText(html) {
  let text = html;

  // Remove script, style, noscript blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');

  // Remove all tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = decodeEntities(text);

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Truncate to reasonable size for indexing (100KB)
  return text.slice(0, 100_000);
}

/**
 * Decode common HTML entities.
 */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ');
}
