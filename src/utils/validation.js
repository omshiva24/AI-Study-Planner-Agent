/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

const { parseDate, addDays, todayUtc, WEEKDAYS } = require('./dates');

const MAX_SUBJECTS = 8;
const MAX_SYLLABUS = 2000;
const MAX_TOPICS = 300;
const STRATEGIES = ['balanced', 'exam_first', 'weak_first'];
const CONFIDENCE = ['weak', 'ok', 'strong'];
const NAME_RE = /^[\p{L}\p{M} .'-]{0,30}$/u;
const SUBJECT_RE = /^[\p{L}\p{M}\p{N} &+().,:#'/-]{1,40}$/u;

/** Removes control characters (keeps new lines) and trims. */
function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\r/g, '')
    .trim()
    .slice(0, max);
}

function fail(message) {
  return { ok: false, error: message };
}

function checkHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0.5 || n > 12) return null;
  return Math.round(n * 2) / 2;
}

function checkRestDay(value) {
  const v = String(value ?? 'none').toLowerCase();
  return v === 'none' || WEEKDAYS.includes(v) ? v : null;
}

/**
 * Validates the subjects list shared by /api/plan and /api/replan.
 * @returns {{ ok: true, value: object[] } | { ok: false, error: string }}
 */
function validateSubjects(list, startDate, { needSyllabus }) {
  if (!Array.isArray(list) || list.length === 0) return fail('Add at least one subject.');
  if (list.length > MAX_SUBJECTS) return fail(`You can plan up to ${MAX_SUBJECTS} subjects at once.`);
  const seen = new Set();
  const out = [];
  for (const [i, raw] of list.entries()) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const name = cleanText(s.name, 40).replace(/\s+/g, ' ');
    if (!SUBJECT_RE.test(name)) return fail(`Subject ${i + 1}: use letters, numbers and simple punctuation (up to 40).`);
    const key = name.toLowerCase();
    if (seen.has(key)) return fail(`"${name}" is listed twice.`);
    seen.add(key);
    const exam = String(s.examDate ?? '');
    if (parseDate(exam) === null) return fail(`${name}: pick a valid exam date.`);
    if (exam <= startDate) return fail(`${name}: the exam date must be after the start date.`);
    if (exam > addDays(startDate, 365)) return fail(`${name}: the exam must be within one year.`);
    const confidence = CONFIDENCE.includes(s.confidence) ? s.confidence : 'ok';
    const subject = { id: `s${i + 1}`, name, examDate: exam, confidence };
    if (needSyllabus) {
      const syllabus = cleanText(s.syllabus, MAX_SYLLABUS + 1);
      if (syllabus.length > MAX_SYLLABUS) return fail(`${name}: keep the syllabus under ${MAX_SYLLABUS} characters.`);
      if (/<<<|>>>/.test(syllabus)) return fail(`${name}: the syllabus contains characters that are not allowed.`);
      subject.syllabus = syllabus;
    } else if (typeof s.id === 'string' && /^s\d$/.test(s.id)) {
      subject.id = s.id;
    }
    out.push(subject);
  }
  return { ok: true, value: out };
}

function checkStart(value, now) {
  const start = String(value ?? '');
  if (parseDate(start) === null) return null;
  const today = todayUtc(now);
  // Allow a day either side of the server's date for time zones.
  if (start < addDays(today, -2) || start > addDays(today, 365)) return null;
  return start;
}

/**
 * Validates the body of POST /api/plan.
 * @param {unknown} body
 * @param {number} [now]
 */
function validatePlanInput(body, now = Date.now()) {
  const b = body && typeof body === 'object' ? body : {};
  const name = cleanText(b.name, 31);
  if (!NAME_RE.test(name)) return fail('Your name can only use letters and spaces (up to 30).');
  const startDate = checkStart(b.startDate, now);
  if (!startDate) return fail('Pick a valid start date (today or later).');
  const hoursPerDay = checkHours(b.hoursPerDay);
  if (hoursPerDay === null) return fail('Study hours per day must be between 0.5 and 12.');
  const restDay = checkRestDay(b.restDay);
  if (restDay === null) return fail('Pick a valid rest day.');
  const subjects = validateSubjects(b.subjects, startDate, { needSyllabus: true });
  if (!subjects.ok) return subjects;
  return { ok: true, value: { name, startDate, hoursPerDay, restDay, subjects: subjects.value } };
}

/**
 * Validates the body of POST /api/replan (topics already exist).
 * @param {unknown} body
 * @param {number} [now]
 */
function validateReplanInput(body, now = Date.now()) {
  const b = body && typeof body === 'object' ? body : {};
  const name = cleanText(b.name, 31);
  if (!NAME_RE.test(name)) return fail('Your name can only use letters and spaces (up to 30).');
  const fromDate = checkStart(b.fromDate, now);
  if (!fromDate) return fail('The update date is not valid.');
  const hoursPerDay = checkHours(b.hoursPerDay);
  if (hoursPerDay === null) return fail('Study hours per day must be between 0.5 and 12.');
  const restDay = checkRestDay(b.restDay);
  if (restDay === null) return fail('Pick a valid rest day.');
  // Exams that are already over are dropped by the client; the rest must be after fromDate.
  const subjects = validateSubjects(b.subjects, addDays(fromDate, -1), { needSyllabus: false });
  if (!subjects.ok) return subjects;
  const ids = new Set(subjects.value.map((s) => s.id));
  if (!Array.isArray(b.topics) || b.topics.length === 0 || b.topics.length > MAX_TOPICS) {
    return fail('The plan has no topics to update.');
  }
  const topics = [];
  const topicIds = new Set();
  for (const raw of b.topics) {
    const t = raw && typeof raw === 'object' ? raw : {};
    if (typeof t.id !== 'string' || !/^t\d{1,4}$/.test(t.id) || topicIds.has(t.id)) return fail('A topic id is not valid.');
    if (!ids.has(t.subjectId)) return fail('A topic belongs to an unknown subject.');
    const hours = checkHours(t.hours);
    if (hours === null) return fail('A topic has invalid hours.');
    const done = Math.max(0, Math.min(hours * 60, Math.round(Number(t.doneMinutes) || 0)));
    topicIds.add(t.id);
    topics.push({
      id: t.id,
      subjectId: t.subjectId,
      title: cleanText(t.title, 80) || 'Topic',
      hours,
      doneMinutes: done,
      difficulty: Math.min(3, Math.max(1, Math.round(Number(t.difficulty) || 2))),
      order: Math.max(0, Math.min(999, Math.round(Number(t.order) || 0))),
    });
  }
  const o = b.options && typeof b.options === 'object' ? b.options : {};
  const options = {
    strategy: STRATEGIES.includes(o.strategy) ? o.strategy : 'balanced',
    revisionDays: Math.min(3, Math.max(0, Math.round(Number(o.revisionDays) || 0))),
    mockTest: o.mockTest !== false,
  };
  return { ok: true, value: { name, fromDate, hoursPerDay, restDay, subjects: subjects.value, topics, options } };
}

module.exports = { validatePlanInput, validateReplanInput, cleanText, STRATEGIES, CONFIDENCE, MAX_SUBJECTS };
