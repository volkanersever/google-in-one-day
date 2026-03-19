-- Crawl jobs track each index(origin, k) invocation
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_url TEXT NOT NULL,
  max_depth INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  indexed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0
);

-- Discovered URLs: the frontier. Global dedup by normalized_url for fetch efficiency.
-- Per-job discovery metadata in page_discoveries.
CREATE TABLE IF NOT EXISTS discovered_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_url TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  depth INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  discovered_from_url TEXT,
  http_status INTEGER,
  error_message TEXT,
  content_type TEXT,
  fetched_at TEXT,
  FOREIGN KEY (job_id) REFERENCES crawl_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_discovered_state ON discovered_urls(state);
CREATE INDEX IF NOT EXISTS idx_discovered_job ON discovered_urls(job_id);

-- Pages: globally unique indexed pages with extracted content
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_url TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  title TEXT,
  body_text TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  content_length INTEGER DEFAULT 0
);

-- Token index for search: term frequencies per page per field
CREATE TABLE IF NOT EXISTS page_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  field TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (page_id) REFERENCES pages(id)
);

CREATE INDEX IF NOT EXISTS idx_page_terms_term ON page_terms(term);
CREATE INDEX IF NOT EXISTS idx_page_terms_page ON page_terms(page_id);

-- Discovery metadata: links a page to the job/origin/depth that discovered it
CREATE TABLE IF NOT EXISTS page_discoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  origin_url TEXT NOT NULL,
  depth INTEGER NOT NULL,
  FOREIGN KEY (page_id) REFERENCES pages(id),
  FOREIGN KEY (job_id) REFERENCES crawl_jobs(id),
  UNIQUE(page_id, job_id, origin_url, depth)
);

-- Frontier queue: items waiting to be fetched (for resume support)
CREATE TABLE IF NOT EXISTS frontier_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_url TEXT NOT NULL,
  url TEXT NOT NULL,
  job_id INTEGER NOT NULL,
  origin_url TEXT NOT NULL,
  depth INTEGER NOT NULL,
  discovered_from_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES crawl_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_frontier_job ON frontier_queue(job_id);

-- System state key-value store
CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- WAL mode is set programmatically in db.js
