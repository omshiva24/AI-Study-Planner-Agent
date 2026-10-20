/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

/**
 * Gemini client using the public REST API and Node's built-in fetch
 * (no SDK, no dependencies). One call = one model turn of the agent.
 * The API key is sent in a header from the server only; it never reaches the browser.
 */

const { AppError } = require('../utils/errors');

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

// Tried after the configured model when a model is unavailable for this key
// or its free quota is used up.
const FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-2.5-flash',
];

/** Removes anything that looks like an API key from a message. */
function redact(text) {
  return String(text).replace(/AIza[\w-]+|AQ\.[\w.-]+/g, '[key]');
}

/** True when trying another model could help (unknown model, quota, overload). */
function shouldTryAnother(status, message) {
  return (
    status === 404 ||
    status === 429 ||
    status === 503 ||
    /is not found|not supported for generateContent|no longer available|quota|RESOURCE_EXHAUSTED|overloaded|UNAVAILABLE|high demand/i.test(message)
  );
}

/**
 * @param {{ apiKey: string, model: string, timeoutMs: number, fetchImpl?: typeof fetch }} options
 * @returns {null | { generate: Function }} null when no key is set (rule-based mode)
 */
function createGeminiModel({ apiKey, model, timeoutMs, fetchImpl = globalThis.fetch }) {
  if (!apiKey) return null;
  let workingModel = null;

  async function callOnce(name, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${API}/${encodeURIComponent(name)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
        const err = new AppError(502, 'AI_FAILED', redact(message));
        err.httpStatus = res.status;
        throw err;
      }
      return data;
    } catch (err) {
      if (err && err.name === 'AbortError') throw Object.assign(new AppError(504, 'AI_TIMEOUT', 'The AI took too long.'), { httpStatus: 504 });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {{ systemInstruction: string, contents: object[], tools?: object[], json?: boolean, pinModel?: string }} req
   * @returns {Promise<{ model: string, functionCalls: object[], content: object|null, text: string }>}
   */
  async function generate({ systemInstruction, contents, tools, json, pinModel }) {
    // Inside one agent conversation the model is pinned (its thought signatures
    // only make sense to the same model); a new conversation may fall back.
    const queue = pinModel ? [pinModel] : [...new Set([workingModel, model, ...FALLBACK_MODELS].filter(Boolean))];
    let lastError;
    for (const name of queue) {
      const generationConfig = { temperature: 0.3 };
      if (/^gemini-3/.test(name)) generationConfig.thinkingConfig = { thinkingLevel: 'LOW' };
      if (json) generationConfig.responseMimeType = 'application/json';
      const body = { systemInstruction: { parts: [{ text: systemInstruction }] }, contents, generationConfig };
      if (tools) {
        body.tools = [{ functionDeclarations: tools }];
        body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
      }
      try {
        const data = await callOnce(name, body);
        workingModel = name;
        const content = data && data.candidates && data.candidates[0] ? data.candidates[0].content || null : null;
        const parts = (content && Array.isArray(content.parts) && content.parts) || [];
        return {
          model: name,
          functionCalls: parts.filter((p) => p.functionCall).map((p) => p.functionCall),
          content,
          text: parts
            .filter((p) => typeof p.text === 'string' && !p.thought)
            .map((p) => p.text)
            .join(''),
        };
      } catch (err) {
        lastError = err;
        console.warn(`[gemini] ${name}:`, redact((err && err.message) || err).slice(0, 200));
        if (pinModel || !shouldTryAnother(err && err.httpStatus, String((err && err.message) || ''))) break;
      }
    }
    throw lastError || new AppError(502, 'AI_FAILED', 'The AI is not available.');
  }

  return { generate };
}

module.exports = { createGeminiModel, FALLBACK_MODELS, redact, shouldTryAnother };
