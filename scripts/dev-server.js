/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

/**
 * Local development server (no dependencies): serves public/ and the same
 * API handlers that Vercel runs. Start with: npm start (not used on Vercel) → http://localhost:8080
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env for local runs (Vercel sets environment variables itself).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const config = require('../src/config');
const { handlers, SECURITY_HEADERS } = require('../src/http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (k !== 'Cache-Control') res.setHeader(k, v);
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

function createServer() {
  const api = handlers();
  return http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/plan') return api.plan(req, res);
    if (pathname === '/api/replan') return api.replan(req, res);
    if (pathname === '/api/status') return api.status(req, res);
    if (pathname === '/health') {
      res.setHeader('Content-Type', 'application/json');
      return res.end('{"status":"ok"}');
    }
    return serveStatic(req, res);
  });
}

if (require.main === module) {
  createServer().listen(config.port, () => {
    console.log(`AI Study Planner Agent running on http://localhost:${config.port}`);
    if (!config.geminiApiKey) console.log('GEMINI_API_KEY is not set: the agent runs with built-in rules only.');
  });
}

module.exports = { createServer };
