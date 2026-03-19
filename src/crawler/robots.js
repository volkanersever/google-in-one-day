import { createLogger } from '../shared/logger.js';
import { config } from '../shared/config.js';

const log = createLogger('robots');

/**
 * Simple robots.txt parser and cache.
 * Caches parsed rules per host. Best-effort — does not block crawling on failure.
 */
export class RobotsChecker {
  constructor() {
    this.cache = new Map(); // hostname -> { rules: [], fetchedAt }
    this.pending = new Map(); // hostname -> Promise
  }

  async isAllowed(urlStr) {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname;
      const path = url.pathname;

      const rules = await this.getRules(hostname, url.origin);
      if (!rules) return true; // If we can't fetch robots.txt, allow

      for (const rule of rules) {
        if (path.startsWith(rule.path)) {
          return rule.allow;
        }
      }
      return true;
    } catch {
      return true;
    }
  }

  async getRules(hostname, origin) {
    const cached = this.cache.get(hostname);
    if (cached) return cached.rules;

    // Avoid concurrent fetches for the same host
    if (this.pending.has(hostname)) {
      return this.pending.get(hostname);
    }

    const promise = this.fetchRobots(hostname, origin);
    this.pending.set(hostname, promise);

    try {
      const rules = await promise;
      this.cache.set(hostname, { rules, fetchedAt: Date.now() });
      return rules;
    } finally {
      this.pending.delete(hostname);
    }
  }

  async fetchRobots(hostname, origin) {
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': config.userAgent },
      });

      if (!response.ok) return null;
      const text = await response.text();
      return this.parse(text);
    } catch {
      log.debug(`Failed to fetch robots.txt for ${hostname}`);
      return null;
    }
  }

  parse(text) {
    const rules = [];
    let relevant = false;

    for (const line of text.split('\n')) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith('user-agent:')) {
        const agent = trimmed.slice('user-agent:'.length).trim();
        relevant = agent === '*' || agent.includes('googleinoneday');
      } else if (relevant && trimmed.startsWith('disallow:')) {
        const path = trimmed.slice('disallow:'.length).trim();
        if (path) rules.push({ path, allow: false });
      } else if (relevant && trimmed.startsWith('allow:')) {
        const path = trimmed.slice('allow:'.length).trim();
        if (path) rules.push({ path, allow: true });
      }
    }

    // Sort longer paths first for specificity
    rules.sort((a, b) => b.path.length - a.path.length);
    return rules;
  }
}
