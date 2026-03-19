import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env file manually (no dotenv dependency)
function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function env(key, fallback) {
  return process.env[key] ?? fallback;
}

function envInt(key, fallback) {
  const v = process.env[key];
  return v !== undefined ? parseInt(v, 10) : fallback;
}

export const config = {
  port: envInt('PORT', 3000),
  dbPath: env('DB_PATH', './data/crawler.db'),
  maxWorkers: envInt('MAX_WORKERS', 8),
  maxQueueDepth: envInt('MAX_QUEUE_DEPTH', 10000),
  requestTimeoutMs: envInt('REQUEST_TIMEOUT_MS', 10000),
  globalRps: envInt('GLOBAL_RPS', 20),
  perHostDelayMs: envInt('PER_HOST_DELAY_MS', 1000),
  maxBodySize: envInt('MAX_BODY_SIZE', 2 * 1024 * 1024), // 2MB
  userAgent: env('USER_AGENT', 'GoogleInOneDay/1.0 (Educational Crawler)'),
  maxRetries: 1,
};
