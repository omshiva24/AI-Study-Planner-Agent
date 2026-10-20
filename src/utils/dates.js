/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

/**
 * Calendar-date helpers. Dates are plain "YYYY-MM-DD" strings and all maths
 * is done in UTC, so a plan never shifts by a day because of time zones.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Parses "YYYY-MM-DD" into a UTC timestamp, or null when invalid (e.g. 2026-02-30).
 * @param {unknown} value
 * @returns {number|null}
 */
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

/** @param {number} t UTC timestamp @returns {string} "YYYY-MM-DD" */
function formatDate(t) {
  return new Date(t).toISOString().slice(0, 10);
}

/** @param {string} date @param {number} n @returns {string} */
function addDays(date, n) {
  return formatDate(parseDate(date) + n * DAY_MS);
}

/** Whole days from a to b (b - a). */
function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** Three-letter weekday key ("sun".."sat"). */
function weekdayKey(date) {
  return WEEKDAYS[new Date(parseDate(date)).getUTCDay()];
}

/** Today's date on the server (UTC). */
function todayUtc(now = Date.now()) {
  return formatDate(now);
}

/** Every date from start up to (not including) end. */
function dateRange(start, end) {
  const out = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(d);
  return out;
}

module.exports = { DAY_MS, WEEKDAYS, parseDate, formatDate, addDays, diffDays, weekdayKey, todayUtc, dateRange };
