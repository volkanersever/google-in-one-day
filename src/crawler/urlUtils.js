import { ALLOWED_PROTOCOLS, SKIP_EXTENSIONS } from '../shared/constants.js';
import { posix } from 'node:path';

/**
 * Normalize a URL for deduplication.
 * - lowercase hostname
 * - strip fragment
 * - normalize default ports
 * - consistent trailing slash for root paths
 * - resolve relative links against base
 */
export function normalizeUrl(rawUrl, baseUrl = null) {
  let urlStr = rawUrl.trim();
  if (!urlStr) return null;

  // Skip non-HTTP protocols
  if (/^(mailto:|javascript:|tel:|data:|ftp:)/i.test(urlStr)) return null;

  let parsed;
  try {
    parsed = baseUrl ? new URL(urlStr, baseUrl) : new URL(urlStr);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;

  // Lowercase hostname
  parsed.hostname = parsed.hostname.toLowerCase();

  // Strip fragment
  parsed.hash = '';

  // Remove default ports
  if ((parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }

  // Normalize path: remove trailing slash except for root
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  parsed.pathname = path;

  // Sort query parameters for consistency
  parsed.searchParams.sort();

  return parsed.toString();
}

/**
 * Check if a URL likely points to a non-HTML resource by extension.
 */
export function shouldSkipByExtension(urlStr) {
  try {
    const url = new URL(urlStr);
    const path = url.pathname.toLowerCase();
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return false;
    const ext = path.slice(lastDot);
    return SKIP_EXTENSIONS.has(ext);
  } catch {
    return true;
  }
}

/**
 * Extract the hostname from a URL for per-host rate limiting.
 */
export function getHostname(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return null;
  }
}

/**
 * Validate that a URL is well-formed and crawlable.
 */
export function isValidCrawlUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    return ALLOWED_PROTOCOLS.has(url.protocol) && !shouldSkipByExtension(urlStr);
  } catch {
    return false;
  }
}
