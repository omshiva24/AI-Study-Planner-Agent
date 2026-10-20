/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

/**
 * The agent's "act" and "check" tools: a deterministic scheduler that turns
 * topics into dated study sessions, and a checker that reports problems.
 * The AI decides WHAT to study and HOW (topics, hours, strategy); this code
 * guarantees the calendar maths is always correct.
 */

const { dateRange, weekdayKey, diffDays } = require('./dates');

const SLOT = 30; // minutes
const MAX_CHUNK = 90; // one sitting
const MAX_MERGED = 120; // same topic, same day
const REVISION_WINDOW = 7; // revision days are found in the last week before an exam
const CONF_WEIGHT = { weak: 1.35, ok: 1, strong: 0.8 };
const URGENT = 0.9; // pressure above this means the subject barely fits
const TYPE_ORDER = { learn: 0, revise: 1, test: 2 };

const floorSlot = (m) => Math.floor(m / SLOT) * SLOT;
const roundSlot = (m) => Math.round(m / SLOT) * SLOT;

/**
 * @typedef {{ id: string, name: string, examDate: string, confidence: string }} Subject
 * @typedef {{ id: string, subjectId: string, title: string, hours: number, doneMinutes?: number, order: number, difficulty?: number }} Topic
 * @typedef {{ strategy?: string, revisionDays?: number, mockTest?: boolean }} Options
 */

/**
 * Builds a schedule and checks it.
 * @param {{ subjects: Subject[], topics: Topic[], startDate: string, hoursPerDay: number, restDay: string, options?: Options }} input
 * @returns {{ sessions: object[], check: { ok: boolean, issues: object[], stats: object } }}
 */
function buildSchedule({ subjects, topics, startDate, hoursPerDay, restDay, options = {} }) {
  const opts = { strategy: 'balanced', revisionDays: 2, mockTest: true, ...options };
  const active = subjects.filter((s) => s.examDate > startDate).sort((a, b) => a.examDate.localeCompare(b.examDate));
  const sessions = [];
  const issues = [];
  if (active.length === 0) {
    return { sessions, check: { ok: true, issues, stats: emptyStats() } };
  }
  const lastExam = active[active.length - 1].examDate;
  const days = dateRange(startDate, lastExam);
  const dayCap = floorSlot(hoursPerDay * 60);
  const examDays = new Set(active.map((s) => s.examDate));
  const cap = new Map();
  for (const d of days) {
    let c = restDay !== 'none' && weekdayKey(d) === restDay ? 0 : dayCap;
    if (examDays.has(d)) c = floorSlot(c / 2); // an exam day is a lighter day
    cap.set(d, c);
  }
  const totalCapacity = [...cap.values()].reduce((a, b) => a + b, 0);

  // 1) Reserve revision days and a mock test just before each exam.
  const softDeadline = new Map();
  const wantedRevision = Math.max(opts.revisionDays, opts.mockTest ? 1 : 0);
  for (const s of active) {
    const window = days.filter((d) => d < s.examDate && diffDays(d, s.examDate) <= REVISION_WINDOW).reverse();
    const reserved = [];
    for (const d of window) {
      if (reserved.length === wantedRevision) break;
      const left = cap.get(d);
      if (left < SLOT) continue;
      const isTest = opts.mockTest && reserved.length === 0;
      const want = isTest ? 90 : s.confidence === 'weak' ? 120 : 90;
      const minutes = Math.min(want, floorSlot(left));
      cap.set(d, left - minutes);
      reserved.push(d);
      sessions.push({
        date: d,
        subjectId: s.id,
        topicId: null,
        title: isTest ? `Mock test: ${s.name}` : `Revise ${s.name}`,
        minutes,
        type: isTest ? 'test' : 'revise',
      });
    }
    if (reserved.length < wantedRevision) {
      issues.push({
        severity: 'warn',
        type: 'revision',
        subjectId: s.id,
        message: `${s.name}: only ${reserved.length} of ${wantedRevision} revision/test days fit before the exam.`,
      });
    }
    softDeadline.set(s.id, reserved.length ? reserved[reserved.length - 1] : s.examDate);
  }

  // 2) Fill the remaining time with topics, most urgent subject first.
  const remaining = new Map(topics.map((t) => [t.id, Math.max(0, roundSlot(t.hours * 60 - (t.doneMinutes || 0)))]));
  const queues = new Map(
    active.map((s) => [
      s.id,
      topics
        .filter((t) => t.subjectId === s.id && remaining.get(t.id) > 0)
        .sort((a, b) => a.order - b.order),
    ]),
  );
  const neededMinutes = [...remaining.values()].reduce((a, b) => a + b, 0);
  const examRank = new Map(active.map((s, i) => [s.id, i]));

  const totalNeed = new Map(active.map((s) => [s.id, queues.get(s.id).reduce((a, t) => a + remaining.get(t.id), 0)]));
  const scheduled = new Map(active.map((s) => [s.id, 0]));
  const windowDays = new Map(active.map((s) => [s.id, Math.max(1, diffDays(startDate, softDeadline.get(s.id)))]));

  const capFrom = (fromIdx, until) => {
    let sum = 0;
    for (let i = fromIdx; i < days.length && days[i] < until; i += 1) sum += cap.get(days[i]);
    return sum;
  };

  days.forEach((d, idx) => {
    let left = cap.get(d);
    let lastSubject = null;
    while (left >= SLOT) {
      const candidates = active.filter((s) => queues.get(s.id).length > 0 && d < s.examDate);
      if (candidates.length === 0) break;
      let best = null;
      let bestScore = Infinity;
      // Pressure = work left / study time left before the subject's revision days.
      const pressure = new Map(
        candidates.map((s) => {
          const need = queues.get(s.id).reduce((a, t) => a + remaining.get(t.id), 0);
          return [s.id, need / Math.max(SLOT, capFrom(idx, softDeadline.get(s.id)))];
        }),
      );
      const urgent = candidates.filter((s) => pressure.get(s.id) >= URGENT);
      for (const s of candidates) {
        let score;
        if (urgent.length > 0) {
          // Time is tight: most urgent subject first, so everything still fits.
          score = urgent.includes(s) ? -pressure.get(s.id) : Infinity;
        } else if (opts.strategy === 'exam_first') {
          score = examRank.get(s.id) * 1e6 - pressure.get(s.id);
        } else {
          // Balanced pace: every subject keeps up with its own deadline, so
          // subjects mix day by day. Weak subjects get a faster pace in weak_first.
          const pace = opts.strategy === 'weak_first' ? CONF_WEIGHT[s.confidence] || 1 : 1;
          const ideal = Math.min(1, ((idx + 1) / Math.max(1, windowDays.get(s.id))) * pace);
          const progress = scheduled.get(s.id) / Math.max(1, totalNeed.get(s.id));
          score = -(ideal - progress) + (s.id === lastSubject ? 0.04 : 0);
        }
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }
      const queue = queues.get(best.id);
      const topic = queue[0];
      const chunk = floorSlot(Math.min(MAX_CHUNK, left, remaining.get(topic.id)));
      if (chunk < SLOT) break;
      const prev = sessions[sessions.length - 1];
      if (prev && prev.date === d && prev.topicId === topic.id && prev.minutes + chunk <= MAX_MERGED) {
        prev.minutes += chunk;
      } else {
        sessions.push({ date: d, subjectId: best.id, topicId: topic.id, title: topic.title, minutes: chunk, type: 'learn' });
      }
      remaining.set(topic.id, remaining.get(topic.id) - chunk);
      scheduled.set(best.id, scheduled.get(best.id) + chunk);
      if (remaining.get(topic.id) <= 0) queue.shift();
      left -= chunk;
      lastSubject = best.id;
    }
    cap.set(d, left);
  });

  sessions.sort((a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
  sessions.forEach((s, i) => {
    s.id = `p${i + 1}`;
  });

  // 3) Check the result.
  const perSubject = active.map((s) => {
    const own = sessions.filter((x) => x.subjectId === s.id);
    const learn = own.filter((x) => x.type === 'learn');
    const leftover = topics.filter((t) => t.subjectId === s.id).reduce((a, t) => a + remaining.get(t.id), 0);
    const finishDate = learn.length ? learn[learn.length - 1].date : null;
    if (leftover > 0) {
      issues.push({
        severity: 'error',
        type: 'overload',
        subjectId: s.id,
        deficitHours: leftover / 60,
        message: `${s.name}: ${fmtHours(leftover)} of topics do not fit before the exam on ${s.examDate}.`,
      });
    } else if (finishDate && finishDate >= softDeadline.get(s.id) && softDeadline.get(s.id) !== s.examDate) {
      issues.push({
        severity: 'warn',
        type: 'tight',
        subjectId: s.id,
        message: `${s.name}: new topics run into the revision days. Tight, but it fits.`,
      });
    }
    return {
      id: s.id,
      name: s.name,
      examDate: s.examDate,
      plannedMinutes: own.reduce((a, x) => a + x.minutes, 0),
      learnMinutes: learn.reduce((a, x) => a + x.minutes, 0),
      leftoverMinutes: leftover,
      finishDate,
      bufferDays: finishDate ? diffDays(finishDate, s.examDate) : null,
    };
  });
  const stats = {
    totalMinutes: sessions.reduce((a, x) => a + x.minutes, 0),
    sessions: sessions.length,
    studyDays: new Set(sessions.map((x) => x.date)).size,
    firstDate: sessions.length ? sessions[0].date : null,
    lastDate: sessions.length ? sessions[sessions.length - 1].date : null,
    neededMinutes,
    capacityMinutes: totalCapacity,
    subjects: perSubject,
  };
  return { sessions, check: { ok: !issues.some((i) => i.severity === 'error'), issues, stats } };
}

function emptyStats() {
  return { totalMinutes: 0, sessions: 0, studyDays: 0, firstDate: null, lastDate: null, neededMinutes: 0, capacityMinutes: 0, subjects: [] };
}

/** "3.5 h", "45 min" */
function fmtHours(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} h`;
}

/**
 * Rule-based fix for overloaded subjects: shrink their topics' hours to fit.
 * @param {Topic[]} topics
 * @param {{ issues: object[], stats: object }} check
 * @returns {{ topics: Topic[], trimmedMinutes: number }}
 */
function shrinkToFit(topics, check) {
  let trimmed = 0;
  const factor = new Map();
  for (const issue of check.issues.filter((i) => i.type === 'overload')) {
    const s = check.stats.subjects.find((x) => x.id === issue.subjectId);
    const planned = s ? s.learnMinutes : 0;
    const need = planned + s.leftoverMinutes;
    factor.set(issue.subjectId, need > 0 ? Math.max(0.2, (planned / need) * 0.95) : 1);
  }
  const out = topics.map((t) => {
    if (!factor.has(t.subjectId)) return t;
    const left = t.hours * 60 - (t.doneMinutes || 0);
    const newLeft = Math.max(SLOT, roundSlot(left * factor.get(t.subjectId)));
    const hours = Math.max(0.5, Math.round(((newLeft + (t.doneMinutes || 0)) / 60) * 2) / 2);
    trimmed += Math.max(0, t.hours * 60 - hours * 60);
    return { ...t, hours };
  });
  return { topics: out, trimmedMinutes: trimmed };
}

module.exports = { buildSchedule, shrinkToFit, fmtHours, SLOT };
