# Product Requirements Document: Google in One Day

## Product Summary

A localhost-runnable web crawler and search engine that demonstrates core search infrastructure concepts: recursive web crawling, incremental indexing, real-time search, concurrency management, and back pressure control. Built from scratch in Node.js without high-level crawler or search frameworks.

## Goals

- **Crawl** any public website recursively up to a configurable depth
- **Index** page content incrementally so search reflects results in real-time
- **Search** indexed pages with relevance-ranked results while crawling is active
- **Observe** system state including queue depth, worker count, and back pressure status
- **Resume** interrupted crawls without re-fetching completed pages
- Demonstrate production-sensible architecture at assignment scope

## Non-Goals

- Distributed multi-machine crawling
- JavaScript-rendered SPA content
- Complex NLP or ML-based ranking
- User authentication or access control
- Real-time WebSocket push (polling is sufficient)
- Full production hardening (security audit, load testing)

## Functional Requirements

### FR1: Indexing — `index(origin, k)`
- Accept an origin URL and max depth `k`
- Crawl recursively: origin at depth 0, direct links at depth 1, etc.
- Never fetch the same URL twice (global deduplication by normalized URL)
- Record for each page: relevant_url, origin_url, depth
- Support multiple concurrent crawl jobs

### FR2: Searching — `search(query)`
- Accept a text query string
- Return relevant URLs as triples: `(relevant_url, origin_url, depth)` with score
- Search must work while indexing is active
- Results must reflect newly indexed pages incrementally
- Sort by relevance descending

### FR3: System Observability
- Expose operational metrics: processed count, queue depth, active workers, back pressure status
- Display per-job progress: discovered, processed, indexed, error counts
- Show recent errors

### FR4: Back Pressure
- Bounded queue with configurable max depth
- Configurable max concurrent workers
- Global request rate limiting
- Per-host politeness delay
- Drop excess URLs when queue is saturated (with metrics)

### FR5: Persistence / Resume
- Persist all crawl state in SQLite
- On restart, resume unfinished jobs from pending queue items
- Skip already-fetched URLs

## Technical Requirements

- **Runtime**: Node.js 20+
- **Storage**: SQLite with WAL mode for concurrent read/write
- **HTTP**: Node.js native fetch
- **Dependencies**: Only `better-sqlite3` for SQLite binding
- **No frameworks** for core logic: crawling, queueing, indexing, search, and relevance must be hand-implemented

## Architecture Overview

```
HTTP Server (native http module)
  ├── REST API (/api/index, /api/search, /api/status, /api/jobs)
  ├── Static file serving (web dashboard)
  └── Controllers
        ├── CrawlerService → Scheduler → FrontierQueue → SQLite
        │                  → RateLimiter (token bucket + per-host delay)
        │                  → RobotsChecker
        │                  → HTMLParser (regex-based)
        │                  → URLUtils (normalization)
        └── IndexService → Tokenizer → page_terms table
                         → Relevance scoring → search results
```

## Data Model

| Table | Purpose |
|-------|---------|
| `crawl_jobs` | Job metadata and counters |
| `discovered_urls` | Global URL registry with state tracking (UNIQUE on normalized_url) |
| `frontier_queue` | Pending fetch queue (for resume support) |
| `pages` | Indexed page content (UNIQUE on normalized_url) |
| `page_terms` | Token frequencies per page per field (indexed on term) |
| `page_discoveries` | Per-job discovery metadata (page → job → origin → depth) |

## UI/UX Requirements

Minimal web dashboard with:
1. **Index form**: URL input + depth input + start button
2. **Search form**: query input + search button + results table
3. **Status panel**: real-time metrics (auto-refresh every 2s)
4. **Jobs table**: per-job progress with status badges
5. **Recent errors**: last 5 failed URLs

No frontend framework required. Vanilla HTML/CSS/JS with polling.

## Acceptance Criteria

1. `npm install && npm run init-db && npm run dev` starts the system
2. Submitting a URL + depth starts crawling; pages appear in search results within seconds
3. Search returns relevant results while crawling is active
4. System status panel shows live queue depth, worker count, and back pressure indicators
5. Same URL is never fetched twice across jobs
6. Back pressure activates when queue reaches capacity
7. Restarting the server resumes unfinished crawl jobs
8. All tests pass: `npm test`

## Risks / Tradeoffs

| Risk | Mitigation |
|------|------------|
| Regex HTML parsing misses content | Acceptable for assignment scope; flag in docs |
| SQLite write contention under heavy load | WAL mode + synchronous better-sqlite3 serializes writes naturally |
| No JS rendering limits SPA crawling | Document as known limitation; out of scope |
| Global URL dedup prevents re-crawling stale content | Trade freshness for efficiency; appropriate for assignment |
| Per-host delay may slow crawls on single-domain targets | Configurable via `PER_HOST_DELAY_MS`; can set to 0 |
