# Google in One Day

A functional web crawler and real-time search engine built from scratch in Node.js. Demonstrates crawling, indexing, concurrent processing, back pressure management, and live search — all implemented manually without high-level crawler or search frameworks.

## Why Node.js?

- **Native `fetch`** and async I/O make concurrent HTTP crawling natural without threads
- **Single-threaded event loop** eliminates most race conditions by design — async operations are serialized at the JS level
- **`better-sqlite3`** provides synchronous DB access, making visited-set checks + enqueue operations atomically consistent within a single tick
- **Mature ecosystem** for the few utilities needed (SQLite binding)

## Architecture

```
┌──────────────┐     ┌──────────┐     ┌──────────────┐
│  Web UI /    │────▶│  HTTP    │────▶│  Controllers │
│  Dashboard   │     │  Server  │     │  (API)       │
└──────────────┘     └──────────┘     └──────┬───────┘
                                             │
                    ┌────────────────────────┬┘
                    ▼                        ▼
             ┌──────────┐            ┌──────────────┐
             │ Crawler   │            │ Index/Search │
             │ Service   │            │ Service      │
             └─────┬─────┘            └──────┬───────┘
                   │                         │
        ┌──────────┼──────────┐              │
        ▼          ▼          ▼              ▼
  ┌──────────┐ ┌────────┐ ┌────────┐  ┌──────────┐
  │ Frontier │ │Scheduler│ │Rate    │  │Tokenizer │
  │ Queue    │ │(Dedup)  │ │Limiter │  │+ Scoring │
  └────┬─────┘ └────┬────┘ └────────┘  └──────────┘
       │            │
       └─────┬──────┘
             ▼
  ┌─────────────────────┐
  │    Dual Storage     │
  │                     │
  │  SQLite (WAL)       │  ← primary: jobs, pages, terms, queue
  │  +                  │
  │  File-based export  │  ← data/storage/[letter].data
  │  (per-letter .data) │     auto-generated after crawl completes
  └─────────────────────┘
```

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Frontier Queue | `src/crawler/frontierQueue.js` | Bounded FIFO queue backed by SQLite for persistence |
| Scheduler | `src/crawler/scheduler.js` | URL admission control with global deduplication |
| Crawler Service | `src/crawler/crawlerService.js` | Worker pool orchestration, fetch pipeline, auto file export |
| Rate Limiter | `src/crawler/rateLimiter.js` | Token bucket (global RPS) + per-host delay |
| HTML Parser | `src/crawler/htmlParser.js` | Regex-based title/text/link extraction |
| URL Utils | `src/crawler/urlUtils.js` | Normalization, validation, extension filtering |
| Index Service | `src/indexer/indexService.js` | Tokenization + immediate DB commit |
| Relevance | `src/indexer/relevance.js` | Relevance scoring with configurable formula |
| Storage Export | `scripts/exportStorage.js` | Export SQLite index to file-based `[letter].data` files |

## Dual Storage Architecture

The system uses a **dual storage** approach:

1. **SQLite (primary)** — All crawl state, page content, and term frequencies are stored in SQLite with WAL mode for concurrent read/write. This powers the real-time API (`/api/search`) and enables live search during indexing.

2. **File-based storage (exported)** — When a crawl job completes, indexed data is automatically exported to `data/storage/[letter].data` files. Each file groups words by their first letter and stores entries as tab-separated values:
   ```
   word    url    origin_url    depth    frequency
   ```
   This powers the `/search` endpoint and provides a simple, inspectable data format. Files can also be regenerated at any time with `npm run export-storage`.

## How Indexing Works

1. **`POST /api/index`** creates a crawl job and enqueues the origin URL at depth 0
2. The **worker loop** dequeues URLs from the frontier, up to `MAX_WORKERS` concurrently
3. Each worker: rate-limits → checks robots.txt → fetches page → parses HTML → extracts links
4. The parsed page is **immediately stored and indexed** in SQLite (title + body + URL tokens)
5. Discovered links are normalized, deduplicated via `UNIQUE` constraint on `discovered_urls`, and enqueued if within depth limit and queue capacity
6. Job counters are updated in real-time
7. When all jobs complete, storage files are **auto-exported** to `data/storage/[letter].data`

## How Search Works

The system exposes **two search endpoints** with different scoring strategies:

### Primary Search — `GET /api/search?q=query`

Tokenizes the query and scores pages using a weighted TF-based formula:
- **Title token match**: +5 × frequency
- **Body token match**: +1 × log(1 + tf)
- **URL token match**: +2 × frequency
- **Phrase bonus**: +10 if query substring appears in title, +3 if in body

Results returned as `(relevant_url, origin_url, depth, score)` triples, sorted by score descending.

### Relevance Search — `GET /search?query=<word>&sortBy=relevance`

Uses a deterministic scoring formula based on term frequency and crawl depth:

```
relevance_score = (frequency × 10) + 1000 (exact match bonus) − (depth × 5)
```

- **frequency × 10**: Higher term frequency = more relevant
- **+1000 exact match bonus**: Applied when any query token matches a stored term exactly
- **depth × 5 penalty**: Deeper pages are penalized (pages closer to origin rank higher)

Results include pagination (`page`, `limit`) and return `(url, origin_url, depth, frequency, relevance_score)`.

## Live Search During Indexing

This is the key architectural property. After each page is fetched and parsed:
- The page content and term frequencies are committed to SQLite **immediately** (synchronous write via `better-sqlite3`)
- SQLite is in **WAL mode**, allowing concurrent reads during writes
- Search queries read the **current committed state** — no need to wait for crawl completion
- New pages become searchable within milliseconds of being fetched

## Back Pressure

The system implements explicit back pressure at multiple levels:

| Mechanism | Config | Behavior |
|-----------|--------|----------|
| Max queue depth | `MAX_QUEUE_DEPTH` (10,000) | Frontier rejects new URLs when full; dropped URLs are counted |
| Max concurrent workers | `MAX_WORKERS` (8) | Limits parallel HTTP requests |
| Global RPS | `GLOBAL_RPS` (20) | Token bucket rate limiter across all hosts |
| Per-host delay | `PER_HOST_DELAY_MS` (1,000) | Minimum interval between requests to the same host |

Back pressure status is exposed via `GET /api/status`:
- `queueSaturated`: true when frontier is at capacity
- `droppedUrls`: count of URLs dropped due to back pressure
- `activeWorkers` / `maxWorkers`: current concurrency

## Deduplication

**Global deduplication** by normalized URL across all jobs. The `discovered_urls` table has a `UNIQUE(normalized_url)` constraint:
- A URL is fetched at most once, regardless of how many jobs discover it
- Discovery metadata (origin, depth, job) is recorded separately in `page_discoveries`
- This avoids redundant fetches while preserving per-origin attribution

## Setup & Run

### Prerequisites
- Node.js 20+
- npm

### Quick Start

```bash
# 1. Clone and install
cd google-in-one-day
npm install

# 2. Create .env (optional — defaults work fine)
cp .env.example .env

# 3. Initialize database
npm run init-db

# 4. Start the server
npm run dev
```

Then open **http://localhost:3600** in your browser.

### API Usage

```bash
# Start a crawl
curl -X POST http://localhost:3600/api/index \
  -H "Content-Type: application/json" \
  -d '{"origin": "https://example.com", "k": 2}'

# Search — primary endpoint (TF-based scoring)
curl "http://localhost:3600/api/search?q=example"

# Search — relevance endpoint (frequency-based scoring with pagination)
curl "http://localhost:3600/search?query=example&sortBy=relevance&page=1&limit=20"

# Check system status
curl http://localhost:3600/api/status

# List all jobs
curl http://localhost:3600/api/jobs

# Pause a running job
curl -X POST http://localhost:3600/api/jobs/1/pause

# Resume a paused job
curl -X POST http://localhost:3600/api/jobs/1/resume

# Cancel a job
curl -X POST http://localhost:3600/api/jobs/1/cancel

# Delete a job and all its data
curl -X DELETE http://localhost:3600/api/jobs/1

# Export storage files manually (auto-runs after crawl completes)
npm run export-storage
```

### CLI

```bash
# Start a crawl directly from terminal
npm run index -- https://example.com 2

# Search from terminal
npm run search -- "your query"

# Check system status
npm run status

# Export indexed data to file-based storage
npm run export-storage
```

### Run Tests

```bash
npm test
```

## Configuration

All settings via environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3600 | HTTP server port |
| `DB_PATH` | `./data/crawler.db` | SQLite database path |
| `MAX_WORKERS` | 8 | Max concurrent fetch workers |
| `MAX_QUEUE_DEPTH` | 10000 | Frontier queue capacity |
| `REQUEST_TIMEOUT_MS` | 10000 | HTTP request timeout |
| `GLOBAL_RPS` | 20 | Max requests per second |
| `PER_HOST_DELAY_MS` | 1000 | Min delay between requests to same host |
| `MAX_BODY_SIZE` | 2097152 | Max response body size (2MB) |
| `USER_AGENT` | GoogleInOneDay/1.0 | Crawler user agent string |

## Resume After Interruption

The system supports lightweight resume:
- All crawl state is persisted in SQLite (jobs, discovered URLs, frontier queue)
- On restart, unfinished jobs are detected and the worker loop resumes from pending frontier items
- Already-fetched URLs are skipped (global dedup via `discovered_urls`)
- File-based storage (`data/storage/`) persists across restarts and can be regenerated with `npm run export-storage`
- Limitation: in-flight requests at interruption time are lost; those URLs may be re-attempted

## Limitations

- **HTML parsing** is regex-based — may miss some links or extract noisy text from complex pages
- **No JavaScript rendering** — SPA content won't be indexed
- **robots.txt** is checked best-effort; crawl-delay directives are not implemented
- **No distributed crawling** — designed for single-machine use
- **Search relevance** is based on term frequency scoring, not PageRank or BM25
- **No authentication handling** — only public pages are crawlable
- **Content extraction** truncates at 2MB per page
- **File-based storage** is regenerated on each crawl completion (not incrementally updated)

## Future Improvements

- BM25 or TF-IDF scoring with inverse document frequency
- PageRank-style link analysis for authority signals
- Persistent robots.txt caching with TTL
- WebSocket-based real-time UI updates
- Worker threads for CPU-intensive parsing
- Content-based deduplication (near-duplicate detection via SimHash)
- Sitemap.xml discovery and priority-based crawling
- Incremental file-based storage updates (currently full export on completion)
- Trie-based storage structure for faster prefix lookups on large datasets
