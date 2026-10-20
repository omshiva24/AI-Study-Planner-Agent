/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

const { cleanText } = require('./validation');

const MAX_TOPICS_PER_SUBJECT = 30;
const CONFIDENCE_FACTOR = { weak: 1.4, ok: 1, strong: 0.7 };
const HARD_WORDS = /algorithm|proof|numerical|problem|derivation|design|analysis|theorem|calculus|transform|optimi[sz]ation|normali[sz]ation|scheduling|deadlock|routing|integration/i;

/** Rounds to the nearest half hour within [0.5, max]. */
function roundHours(h, max = 12) {
  return Math.min(max, Math.max(0.5, Math.round(h * 2) / 2));
}

/**
 * Splits free-text syllabus into topic titles, in order.
 * Understands "Unit 1: a, b, c", bullet lists, numbered lists and semicolons.
 * @param {string} text
 * @returns {string[]}
 */
function splitSyllabus(text) {
  const lines = String(text || '')
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  const titles = [];
  for (const line of lines) {
    const unit = line.match(/^(?:unit|module|chapter|part|week)\s*[-–]?\s*([0-9ivxlc]+)\s*[:.)–-]?\s*(.*)$/i);
    let body = unit ? unit[2] : line.replace(/^(?:[-*•▪◦]|\d+[.)]|[a-z][.)])\s+/i, '');
    body = body.trim();
    if (!body) {
      if (unit) titles.push(`Unit ${unit[1].toUpperCase()}`);
      continue;
    }
    const parts = body
      .split(/,|\s+[-–]\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 1);
    if (parts.length <= 3) {
      titles.push(parts.join(', ') || body);
    } else {
      // Long lists become topics of two or three items each.
      const size = parts.length % 3 === 1 ? 2 : 3;
      for (let i = 0; i < parts.length; i += size) titles.push(parts.slice(i, i + size).join(', '));
    }
  }
  const seen = new Set();
  return titles
    .map((t) => cleanText(t, 80))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, MAX_TOPICS_PER_SUBJECT);
}

/**
 * Rule-based topics for one subject (used when the AI is not available).
 * @param {{ id: string, name: string, syllabus?: string, confidence: string }} subject
 * @returns {{ subjectId: string, title: string, hours: number, difficulty: number }[]}
 */
function ruleTopics(subject) {
  let titles = splitSyllabus(subject.syllabus);
  if (titles.length === 0) titles = ['Part 1: basics', 'Part 2: core ideas', 'Part 3: problems and practice'].map((p) => `${subject.name} ${p}`);
  const factor = CONFIDENCE_FACTOR[subject.confidence] || 1;
  return titles.map((title) => {
    const difficulty = HARD_WORDS.test(title) ? 3 : title.length > 45 ? 2 : 2;
    const base = difficulty === 3 ? 2.5 : 2;
    return { subjectId: subject.id, title, hours: roundHours(base * factor, 8), difficulty };
  });
}

/**
 * Cleans topics proposed by the AI and gives them stable ids.
 * Unknown subjects are dropped; subjects with no topics get rule-based ones.
 * @param {object[]} raw - [{ subject, title, hours, difficulty }]
 * @param {object[]} subjects
 * @returns {{ topics: object[], filled: string[] }}
 */
function normaliseTopics(raw, subjects) {
  const byName = new Map(subjects.map((s) => [s.name.toLowerCase(), s]));
  const perSubject = new Map(subjects.map((s) => [s.id, []]));
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const subject = byName.get(String(item.subject || '').trim().toLowerCase());
    if (!subject) continue;
    const list = perSubject.get(subject.id);
    if (list.length >= MAX_TOPICS_PER_SUBJECT) continue;
    const title = cleanText(item.title, 80).replace(/\s+/g, ' ');
    if (!title) continue;
    const hours = roundHours(Number(item.hours) || 2, 8);
    const difficulty = Math.min(3, Math.max(1, Math.round(Number(item.difficulty) || 2)));
    list.push({ subjectId: subject.id, title, hours, difficulty });
  }
  const filled = [];
  for (const s of subjects) {
    if (perSubject.get(s.id).length === 0) {
      perSubject.set(s.id, ruleTopics(s));
      filled.push(s.name);
    }
  }
  const topics = [];
  let n = 0;
  for (const s of subjects) {
    perSubject.get(s.id).forEach((t, order) => {
      n += 1;
      topics.push({ id: `t${n}`, ...t, order, doneMinutes: 0 });
    });
  }
  return { topics, filled };
}

/** Rule-based topics for every subject, with ids. */
function allRuleTopics(subjects) {
  const raw = subjects.flatMap((s) => ruleTopics(s).map((t) => ({ ...t, subject: s.name })));
  return normaliseTopics(raw, subjects).topics;
}

module.exports = { splitSyllabus, ruleTopics, normaliseTopics, allRuleTopics, roundHours, MAX_TOPICS_PER_SUBJECT };
