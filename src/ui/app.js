// Dashboard client-side JavaScript — vanilla JS, no frameworks
const API = '';

// DOM references
const $ = id => document.getElementById(id);

// Status polling
async function fetchStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const data = await res.json();
    updateStatus(data);
  } catch (e) {
    console.error('Failed to fetch status:', e);
  }
}

function updateStatus(s) {
  $('stat-active-jobs').textContent = s.activeJobs ?? 0;
  $('stat-queue-depth').textContent = s.queueDepth ?? 0;
  $('stat-max-queue').textContent = s.maxQueueDepth ?? 0;
  $('stat-active-workers').textContent = s.activeWorkers ?? 0;
  $('stat-max-workers').textContent = s.maxWorkers ?? 0;
  $('stat-processed').textContent = s.processedCount ?? 0;
  $('stat-indexed').textContent = s.indexedCount ?? 0;
  $('stat-errors').textContent = s.errorCount ?? 0;
  $('stat-dropped').textContent = s.droppedUrls ?? 0;

  const indRunning = $('ind-running');
  const indSaturated = $('ind-saturated');
  const indThrottled = $('ind-throttled');

  indRunning.className = 'indicator' + (s.running ? ' active' : '');
  indSaturated.className = 'indicator' + (s.queueSaturated ? ' warning' : '');
  indThrottled.className = 'indicator' + (s.throttled ? ' warning' : '');

  // Update recent errors
  if (s.recentErrors && s.recentErrors.length > 0) {
    $('recent-errors').innerHTML = s.recentErrors.map(e =>
      `<div class="error-item">
        <span class="error-url">${escHtml(e.normalized_url || '')}</span>
        — ${escHtml(e.error_message || 'Unknown error')}
        ${e.http_status ? ` (HTTP ${e.http_status})` : ''}
      </div>`
    ).join('');
  } else {
    $('recent-errors').innerHTML = '<p class="muted">No recent errors.</p>';
  }
}

// Jobs polling
async function fetchJobs() {
  try {
    const res = await fetch(`${API}/api/jobs`);
    const jobs = await res.json();
    updateJobs(jobs);
  } catch (e) {
    console.error('Failed to fetch jobs:', e);
  }
}

function updateJobs(jobs) {
  const tbody = $('jobs-body');
  if (!jobs || jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">No jobs yet.</td></tr>';
    return;
  }
  tbody.innerHTML = jobs.map(j =>
    `<tr>
      <td>${j.id}</td>
      <td class="url-cell"><a href="${escAttr(j.origin_url)}" target="_blank">${escHtml(j.origin_url)}</a></td>
      <td>${j.max_depth}</td>
      <td><span class="status-badge ${j.status}">${j.status}</span></td>
      <td>${j.discovered_count}</td>
      <td>${j.processed_count}</td>
      <td>${j.indexed_count}</td>
      <td>${j.error_count}</td>
      <td>${j.queued_count}</td>
    </tr>`
  ).join('');
}

// Index form
$('index-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const origin = $('origin-url').value.trim();
  const k = parseInt($('crawl-depth').value, 10);
  const resultDiv = $('index-result');

  if (!origin) {
    resultDiv.textContent = 'Please enter a URL.';
    resultDiv.className = 'result-msg error';
    return;
  }

  try {
    resultDiv.textContent = 'Starting crawl...';
    resultDiv.className = 'result-msg';

    const res = await fetch(`${API}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, k }),
    });
    const data = await res.json();

    if (res.ok) {
      resultDiv.textContent = `Job #${data.jobId} started for ${data.origin} (depth: ${data.maxDepth})`;
      resultDiv.className = 'result-msg success';
      fetchJobs();
    } else {
      resultDiv.textContent = data.error || 'Failed to start job';
      resultDiv.className = 'result-msg error';
    }
  } catch (err) {
    resultDiv.textContent = 'Network error: ' + err.message;
    resultDiv.className = 'result-msg error';
  }
});

// Search form
$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = $('search-query').value.trim();
  if (!query) return;

  try {
    const res = await fetch(`${API}/api/search?q=${encodeURIComponent(query)}`);
    const results = await res.json();

    const table = $('results-table');
    const noResults = $('no-results');
    const tbody = $('results-body');

    if (Array.isArray(results) && results.length > 0) {
      table.classList.remove('hidden');
      noResults.classList.add('hidden');
      tbody.innerHTML = results.slice(0, 100).map(r =>
        `<tr>
          <td>${r.score}</td>
          <td class="url-cell"><a href="${escAttr(r.relevant_url)}" target="_blank">${escHtml(r.relevant_url)}</a></td>
          <td>${escHtml(r.title || '—')}</td>
          <td class="url-cell"><a href="${escAttr(r.origin_url)}" target="_blank">${escHtml(r.origin_url)}</a></td>
          <td>${r.depth}</td>
        </tr>`
      ).join('');
    } else {
      table.classList.add('hidden');
      noResults.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Search error:', err);
  }
});

// Helpers
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Polling: refresh status and jobs every 2 seconds
fetchStatus();
fetchJobs();
setInterval(() => {
  fetchStatus();
  fetchJobs();
}, 2000);
