import { startIndex, search, searchLegacy, getStatus, getJobs, getJob, pauseJob, resumeJob, cancelJob, deleteJob } from '../api/controllers.js';

/**
 * Simple router for the HTTP server.
 * Parses URL and method, dispatches to controllers.
 */
export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // API routes
    if (path === '/api/index' && method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await startIndex(body);
      sendJson(res, result.status, result.body);
      return;
    }

    if (path === '/api/search' && method === 'GET') {
      const query = url.searchParams.get('q');
      const result = search(query);
      sendJson(res, result.status, result.body);
      return;
    }

    // Legacy search endpoint: GET /search?query=<word>&sortBy=relevance&page=1&limit=20
    if (path === '/search' && method === 'GET') {
      const query = url.searchParams.get('query');
      const sortBy = url.searchParams.get('sortBy') || 'relevance';
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const result = await searchLegacy(query, sortBy, page, limit);
      sendJson(res, result.status, result.body);
      return;
    }

    if (path === '/api/status' && method === 'GET') {
      const result = getStatus();
      sendJson(res, result.status, result.body);
      return;
    }

    if (path === '/api/jobs' && method === 'GET') {
      const result = getJobs();
      sendJson(res, result.status, result.body);
      return;
    }

    // Job action routes: /api/jobs/:id/pause, /api/jobs/:id/resume, /api/jobs/:id/cancel
    const jobActionMatch = path.match(/^\/api\/jobs\/(\d+)\/(pause|resume|cancel)$/);
    if (jobActionMatch && method === 'POST') {
      const [, id, action] = jobActionMatch;
      let result;
      if (action === 'pause') result = pauseJob(id);
      else if (action === 'resume') result = await resumeJob(id);
      else if (action === 'cancel') result = cancelJob(id);
      sendJson(res, result.status, result.body);
      return;
    }

    // DELETE /api/jobs/:id
    const jobDeleteMatch = path.match(/^\/api\/jobs\/(\d+)$/);
    if (jobDeleteMatch && method === 'DELETE') {
      const [, id] = jobDeleteMatch;
      const result = deleteJob(id);
      sendJson(res, result.status, result.body);
      return;
    }

    if (path.startsWith('/api/jobs/') && method === 'GET') {
      const id = path.split('/').pop();
      const result = getJob(id);
      sendJson(res, result.status, result.body);
      return;
    }

    // Static files — serve the UI
    if (method === 'GET') {
      const { serveStatic } = await import('./static.js');
      await serveStatic(req, res, path);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Request error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
