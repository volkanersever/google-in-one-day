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
       ┌──────────┐
       │  SQLite   │
       │  (WAL)    │
       └──────────┘
```

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Frontier Queue | `src/crawler/frontierQueue.js` | Bounded FIFO queue backed by SQLite for persistence |
| Scheduler | `src/crawler/scheduler.js` | URL admission control with global deduplication |
| Crawler Service | `src/crawler/crawlerService.js` | Worker pool orchestration, fetch pipeline |
| Rate Limiter | `src/crawler/rateLimiter.js` | Token bucket (global RPS) + per-host delay |
| HTML Parser | `src/crawler/htmlParser.js` | Regex-based title/text/link extraction |
| URL Utils | `src/crawler/urlUtils.js` | Normalization, validation, extension filtering |
| Index Service | `src/indexer/indexService.js` | Tokenization + immediate DB commit |
| Relevance | `src/indexer/relevance.js` | TF-based scoring with title/URL boosts |

## How Indexing Works

1. **`POST /api/index`** creates a crawl job and enqueues the origin URL at depth 0
2. The **worker loop** dequeues URLs from the frontier, up to `MAX_WORKERS` concurrently
3. Each worker: rate-limits → checks robots.txt → fetches page → parses HTML → extracts links
4. The parsed page is **immediately stored and indexed** in SQLite (title + body + URL tokens)
5. Discovered links are normalized, deduplicated via `UNIQUE` constraint on `discovered_urls`, and enqueued if within depth limit and queue capacity
6. Job counters are updated in real-time

## How Search Works

1. **`GET /api/search?q=query`** tokenizes the query (lowercase, split, stopword removal)
2. Matching tokens are looked up in the `page_terms` table via index scan
3. Each matching page is scored:
   - **Title token match**: +5 × frequency
   - **Body token match**: +1 × log(1 + tf)
   - **URL token match**: +2 × frequency
   - **Phrase bonus**: +10 if query substring appears in title, +3 if in body
4. Results are returned as `(relevant_url, origin_url, depth, score)` triples, sorted by score descending

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

Then open **http://localhost:3000** in your browser.

### API Usage

```bash
# Start a crawl
curl -X POST http://localhost:3000/api/index \
  -H "Content-Type: application/json" \
  -d '{"origin": "https://example.com", "k": 2}'

# Search (works while crawling)
curl "http://localhost:3000/api/search?q=example"

# Check system status
curl http://localhost:3000/api/status

# List all jobs
curl http://localhost:3000/api/jobs

# Pause a running job
curl -X POST http://localhost:3000/api/jobs/1/pause

# Resume a paused job
curl -X POST http://localhost:3000/api/jobs/1/resume

# Cancel a job
curl -X POST http://localhost:3000/api/jobs/1/cancel
```

### CLI

```bash
# Start a crawl directly from terminal
npm run index -- https://example.com 2

# Search from terminal
npm run search -- "your query"

# Check system status
npm run status
```

### Run Tests

```bash
npm test
```

## Configuration

All settings via environment variables (or `.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
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
- Limitation: in-flight requests at interruption time are lost; those URLs may be re-attempted

## Limitations

- **HTML parsing** is regex-based — may miss some links or extract noisy text from complex pages
- **No JavaScript rendering** — SPA content won't be indexed
- **robots.txt** is checked best-effort; crawl-delay directives are not implemented
- **No distributed crawling** — designed for single-machine use
- **Search relevance** is basic TF-based scoring, not PageRank or BM25
- **No authentication handling** — only public pages are crawlable
- **Content extraction** truncates at 100KB per page

## Future Improvements

- BM25 or TF-IDF scoring with document frequency
- PageRank-style link analysis
- Persistent robots.txt caching with TTL
- WebSocket-based real-time UI updates
- Worker threads for CPU-intensive parsing
- Content-based deduplication (near-duplicate detection)
- Sitemap.xml discovery and priority-based crawling
