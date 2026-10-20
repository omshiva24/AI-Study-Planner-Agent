/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

/**
 * Shared HTTP layer for the API, used by the Vercel functions in /api and by
 * the local server. Plain Node (no framework): security headers, JSON body
 * parsing with a size limit, a small rate limiter and friendly errors.
 */

const config = require('./config');
const { AppError } = require('./utils/errors');
const { validatePlanInput, validateReplanInput } = require('./utils/validation');
const { createGeminiModel } = require('./services/geminiRest');
const { runPlanAgent, runReplanAgent } = require('./services/plannerAgent');

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cache-Control': 'no-store',
};

function send(res, status, body) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Reads a JSON body (Vercel may have parsed it already). */
async function readJson(req, limit) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > limit) throw new AppError(413, 'TOO_LARGE', 'That is too much text. Please shorten the syllabus.');
    return req.body;
  }
  let raw = '';
  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    raw = String(req.body);
  } else {
    raw = await new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      // Keep reading (but not storing) past the limit, so a clear 413 can be sent.
      req.on('data', (c) => {
        size += c.length;
        if (size <= limit) chunks.push(c);
      });
      req.on('end', () => {
        if (size > limit) reject(new AppError(413, 'TOO_LARGE', 'That is too much text. Please shorten the syllabus.'));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', reject);
    });
  }
  if (Buffer.byteLength(raw) > limit) throw new AppError(413, 'TOO_LARGE', 'That is too much text. Please shorten the syllabus.');
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new AppError(400, 'BAD_JSON', 'The request was not valid.');
  }
}

/** Fixed-window rate limiter per IP (per server instance). */
function createRateLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 5000) hits.clear();
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

function clientIp(req) {
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Builds the API handlers. Dependencies are injectable for tests.
 * @param {{ model?: object|null, limiter?: Function, now?: () => number }} [deps]
 */
function createHandlers(deps = {}) {
  const model =
    deps.model !== undefined
      ? deps.model
      : createGeminiModel({ apiKey: config.geminiApiKey, model: config.geminiModel, timeoutMs: config.aiTimeoutMs });
  const limiter = deps.limiter || createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax });

  const wrap = (method, fn) => async (req, res) => {
    try {
      if (req.method !== method) {
        res.setHeader('Allow', method);
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      }
      send(res, 200, await fn(req));
    } catch (err) {
      const isApp = err instanceof AppError;
      if (!isApp) console.error('[api] error:', err && err.stack ? err.stack : err);
      const status = isApp ? err.status : 500;
      send(res, status, {
        error: { code: isApp ? err.code : 'ERROR', message: isApp && status < 500 ? err.message : 'Something went wrong. Please try again.' },
      });
    }
  };

  const limited = (req) => {
    if (!limiter(clientIp(req))) throw new AppError(429, 'TOO_MANY_REQUESTS', 'Too many plans at once. Please wait a minute.');
  };

  return {
    status: wrap('GET', async () => ({ ai: Boolean(model) })),
    plan: wrap('POST', async (req) => {
      limited(req);
      const v = validatePlanInput(await readJson(req, 32 * 1024), deps.now ? deps.now() : Date.now());
      if (!v.ok) throw new AppError(400, 'BAD_INPUT', v.error);
      return runPlanAgent(v.value, { model, budgetMs: config.agentBudgetMs });
    }),
    replan: wrap('POST', async (req) => {
      limited(req);
      const v = validateReplanInput(await readJson(req, 96 * 1024), deps.now ? deps.now() : Date.now());
      if (!v.ok) throw new AppError(400, 'BAD_INPUT', v.error);
      return runReplanAgent(v.value, { model });
    }),
  };
}

let shared = null;
/** One set of handlers per server instance (keeps the limiter and model warm). */
function handlers() {
  if (!shared) shared = createHandlers();
  return shared;
}

module.exports = { createHandlers, handlers, createRateLimiter, readJson, SECURITY_HEADERS };
