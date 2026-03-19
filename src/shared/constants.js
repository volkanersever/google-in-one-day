export const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const URL_STATE = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
export const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
  '.css', '.js', '.json', '.xml', '.rss', '.atom',
  '.woff', '.woff2', '.ttf', '.eot',
  '.exe', '.dmg', '.msi', '.apk',
]);

export const HTML_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
];
