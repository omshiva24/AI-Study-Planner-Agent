/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

/** All settings come from environment variables, so no secret is written in the code. */
function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const config = Object.freeze({
  port: readInt('PORT', 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  aiTimeoutMs: readInt('AI_TIMEOUT_MS', 20000),
  agentBudgetMs: readInt('AGENT_BUDGET_MS', 45000),
  rateLimitWindowMs: readInt('RATE_LIMIT_WINDOW_MS', 60 * 1000),
  rateLimitMax: readInt('RATE_LIMIT_MAX', 8),
});

module.exports = config;
