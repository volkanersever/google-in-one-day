import { createLogger } from '../shared/logger.js';

const log = createLogger('rateLimiter');

/**
 * Token bucket rate limiter for global RPS control.
 */
export class RateLimiter {
  constructor(rps) {
    this.rps = rps;
    this.tokens = rps;
    this.maxTokens = rps;
    this.lastRefill = Date.now();
    this.waiters = [];
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.rps);
    this.lastRefill = now;
  }

  async acquire() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until a token is available
    const waitMs = ((1 - this.tokens) / this.rps) * 1000;
    return new Promise(resolve => {
      setTimeout(() => {
        this.refill();
        this.tokens = Math.max(0, this.tokens - 1);
        resolve();
      }, Math.ceil(waitMs));
    });
  }
}

/**
 * Per-host politeness delay tracker.
 * Ensures minimum delay between requests to the same host.
 */
export class HostDelayTracker {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.lastAccess = new Map(); // hostname -> timestamp
  }

  async waitForHost(hostname) {
    if (this.delayMs <= 0) return;

    const last = this.lastAccess.get(hostname);
    if (last) {
      const elapsed = Date.now() - last;
      if (elapsed < this.delayMs) {
        await new Promise(r => setTimeout(r, this.delayMs - elapsed));
      }
    }
    this.lastAccess.set(hostname, Date.now());

    // Prune old entries to prevent memory leak
    if (this.lastAccess.size > 10000) {
      const cutoff = Date.now() - this.delayMs * 2;
      for (const [host, ts] of this.lastAccess) {
        if (ts < cutoff) this.lastAccess.delete(host);
      }
    }
  }
}
