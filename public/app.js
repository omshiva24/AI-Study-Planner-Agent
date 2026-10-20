/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

(() => {
  const STORE = 'studyPlannerAgent.v1';
  const COLORS = ['#5b2ee5', '#0a6e8a', '#0f7b53', '#c2410c', '#be185d', '#7c3aed', '#a16207', '#1d4ed8'];
  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const MAX_SUBJECTS = 8;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  /** Creates an element. Text always goes in with textContent, never parsed as HTML. */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- dates
  const pad = (n) => String(n).padStart(2, '0');
  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const toUTC = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const addDays = (s, n) => new Date(toUTC(s) + n * 864e5).toISOString().slice(0, 10);
  const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
  const weekday = (s) => WEEKDAYS[new Date(toUTC(s)).getUTCDay()];
  const fmtDay = (s) => new Date(toUTC(s)).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function fmtMin(m) {
    if (m < 60) return `${m} min`;
    const h = Math.round((m / 60) * 10) / 10;
    return `${h} h`;
  }
  const timeToMin = (t) => {
    const [h, m] = String(t || '18:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const minToTime = (m) => {
    const x = ((m % 1440) + 1440) % 1440;
    return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
  };
  function stampAt(date, min) {
    const off = Math.floor(min / 1440);
    const m = min - off * 1440;
    return `${addDays(date, off).replace(/-/g, '')}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
  }

  // -------------------------------------------------------------- storage
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || null;
    } catch {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      /* private mode or full: the plan still works for this visit */
    }
  }
  let state = load() || { input: null, plan: null };
  let idSeq = Date.now();
  const newId = () => `x${(idSeq++).toString(36)}`;

  // ------------------------------------------------------------ AI status
  fetch('/api/status')
    .then((r) => r.json())
    .then((d) => {
      const c = $('aiChip');
      c.hidden = false;
      c.textContent = d.ai ? '✨ Gemini AI' : '⚙️ Rules mode';
      c.className = `chip ${d.ai ? 'chip-ai' : 'chip-muted'}`;
    })
    .catch(() => {});

  // ----------------------------------------------------------------- form
  const subjectsBox = $('subjects');
  let uid = 0;

  function renumber() {
    const items = [...subjectsBox.children];
    items.forEach((n, i) => {
      n.querySelector('.num').textContent = String(i + 1);
      n.querySelector('.remove').hidden = items.length === 1;
    });
    $('addSubject').hidden = items.length >= MAX_SUBJECTS;
  }

  function addSubject(data = {}) {
    if (subjectsBox.children.length >= MAX_SUBJECTS) return;
    const node = $('subjectTpl').content.firstElementChild.cloneNode(true);
    uid += 1;
    const group = `conf${uid}`;
    node.querySelectorAll('.seg input').forEach((r) => {
      r.name = group;
      r.checked = r.value === (data.confidence || 'ok');
    });
    const label = node.querySelector('.conf-label');
    label.id = `${group}-label`;
    node.querySelector('.seg').setAttribute('aria-labelledby', label.id);
    node.querySelector('.s-name').value = data.name || '';
    const exam = node.querySelector('.s-exam');
    exam.value = data.examDate || '';
    exam.min = localToday();
    node.querySelector('.s-syl').value = data.syllabus || '';
    node.querySelector('.remove').addEventListener('click', () => {
      if (subjectsBox.children.length > 1) {
        node.remove();
        renumber();
      }
    });
    subjectsBox.append(node);
    renumber();
    return node;
  }

  function updateHours() {
    $('hoursOut').textContent = `${$('hours').value} h`;
  }

  function readForm() {
    return {
      name: $('name').value.trim(),
      startDate: $('startDate').value,
      hoursPerDay: Number($('hours').value),
      startTime: $('startTime').value || '18:00',
      restDay: $('restDay').value,
      subjects: [...subjectsBox.children].map((n) => ({
        name: n.querySelector('.s-name').value.trim(),
        examDate: n.querySelector('.s-exam').value,
        confidence: (n.querySelector('.seg input:checked') || {}).value || 'ok',
        syllabus: n.querySelector('.s-syl').value,
      })),
    };
  }

  function fillForm(input) {
    const today = localToday();
    $('name').value = input.name || '';
    $('startDate').value = input.startDate && input.startDate >= today ? input.startDate : today;
    $('hours').value = input.hoursPerDay || 3;
    updateHours();
    $('startTime').value = input.startTime || '18:00';
    $('restDay').value = input.restDay || 'sun';
    subjectsBox.textContent = '';
    (input.subjects && input.subjects.length ? input.subjects : [{}]).forEach((s) => addSubject(s));
  }

  function fillExample() {
    const t = localToday();
    fillForm({
      name: $('name').value,
      startDate: t,
      hoursPerDay: 3,
      startTime: '18:00',
      restDay: 'sun',
      subjects: [
        {
          name: 'DBMS',
          examDate: addDays(t, 18),
          confidence: 'weak',
          syllabus:
            'Unit 1: Introduction, data models, ER model\nUnit 2: Relational model, keys, relational algebra\nUnit 3: SQL queries, joins, subqueries\nUnit 4: Normalization: 1NF, 2NF, 3NF, BCNF\nUnit 5: Transactions, concurrency control, recovery',
        },
        {
          name: 'Operating Systems',
          examDate: addDays(t, 22),
          confidence: 'ok',
          syllabus: 'Unit 1: Processes and threads\nUnit 2: CPU scheduling algorithms\nUnit 3: Deadlocks\nUnit 4: Memory management, paging\nUnit 5: File systems',
        },
        {
          name: 'Computer Networks',
          examDate: addDays(t, 26),
          confidence: 'strong',
          syllabus: 'OSI and TCP/IP models; Data link layer; Routing algorithms; Transport layer: TCP, UDP; Application layer: HTTP, DNS',
        },
      ],
    });
  }

  function clientCheck(input) {
    if (!input.startDate) return 'Pick a start date.';
    for (const [i, s] of input.subjects.entries()) {
      if (!s.name) return `Give subject ${i + 1} a name.`;
      if (!s.examDate) return `Pick the exam date for ${s.name}.`;
      if (s.examDate <= input.startDate) return `${s.name}: the exam date must be after the start date.`;
    }
    return '';
  }

  // ------------------------------------------------------------------ API
  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'Something went wrong. Please try again.');
    return data;
  }

  // ---------------------------------------------------------------- steps
  function stepItem(s) {
    const li = el('li');
    li.append(el('span', `tag tag-${s.phase}`, s.phase), el('span', null, s.text));
    return li;
  }
  async function playSteps(list, steps, delay = 380) {
    list.textContent = '';
    list.hidden = false;
    for (const s of steps) {
      list.append(stepItem(s));
      await sleep(reduced ? 0 : delay);
    }
  }

  // ------------------------------------------------------------- planning
  function decorate(plan) {
    plan.subjects.forEach((s, i) => {
      s.color = COLORS[i % COLORS.length];
    });
    plan.sessions = plan.sessions.map((s) => ({ ...s, id: newId(), status: null }));
    plan.createdAt = new Date().toISOString();
    return plan;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const input = readForm();
    const box = $('formError');
    const problem = clientCheck(input);
    if (problem) {
      box.textContent = problem;
      box.hidden = false;
      return;
    }
    box.hidden = true;
    $('planBtn').disabled = true;
    $('agent').hidden = false;
    $('steps').textContent = '';
    $('thinking').hidden = false;
    $('agentTitle').focus();
    const msgs = ['Reading your syllabus…', 'Splitting it into topics…', 'Estimating study hours…', 'Building your calendar…', 'Checking that it all fits…'];
    let k = 0;
    $('thinkingText').textContent = msgs[0];
    const timer = setInterval(() => {
      k = Math.min(k + 1, msgs.length - 1);
      $('thinkingText').textContent = msgs[k];
    }, 2200);
    try {
      const plan = await post('/api/plan', input);
      clearInterval(timer);
      $('thinking').hidden = true;
      await playSteps($('steps'), plan.steps);
      state = { input, plan: decorate(plan) };
      save();
      await sleep(reduced ? 0 : 600);
      showPlan(true);
    } catch (ex) {
      clearInterval(timer);
      $('thinking').hidden = true;
      $('agent').hidden = true;
      box.textContent = ex.message;
      box.hidden = false;
    } finally {
      $('planBtn').disabled = false;
    }
  }

  // ------------------------------------------------------------- progress
  function credit(s) {
    if (s.type !== 'learn') return 0;
    if (s.status === 'done') return s.minutes;
    if (s.status === 'half') return Math.round(s.minutes / 2);
    return 0;
  }
  function topicDone(plan) {
    const m = new Map(plan.topics.map((t) => [t.id, 0]));
    for (const s of plan.sessions) if (s.topicId && m.has(s.topicId)) m.set(s.topicId, m.get(s.topicId) + credit(s));
    return m;
  }

  // ----------------------------------------------------------------- view
  function showPlan(focus) {
    const { plan } = state;
    $('hero').hidden = true;
    $('setup').hidden = true;
    $('agent').hidden = true;
    $('planView').hidden = false;
    const chip = $('modeChip');
    chip.textContent = plan.mode === 'ai' ? '✨ Planned by Gemini AI' : '⚙️ Planned by built-in rules';
    chip.className = `chip ${plan.mode === 'ai' ? 'chip-ai' : 'chip-muted'}`;
    $('summaryText').textContent = plan.summary;
    const tips = $('tips');
    tips.textContent = '';
    plan.tips.forEach((t) => tips.append(el('li', null, t)));
    const ps = $('planSteps');
    ps.textContent = '';
    plan.steps.forEach((s) => ps.append(stepItem(s)));
    if (plan.lastReplan) {
      const rs = $('replanSteps');
      rs.textContent = '';
      plan.lastReplan.steps.forEach((s) => rs.append(stepItem(s)));
      rs.hidden = false;
      $('replanMsg').textContent = plan.lastReplan.message;
      $('replanMsg').hidden = false;
    }
    refresh();
    if (focus) $('planTitle').focus();
  }

  function refresh() {
    renderStats();
    renderIssues();
    renderBars();
    renderDays();
  }

  function renderStats() {
    const { plan } = state;
    const learnTotal = plan.topics.reduce((a, t) => a + t.hours * 60, 0);
    const done = [...topicDone(plan).values()].reduce((a, b) => a + b, 0);
    const total = plan.sessions.reduce((a, s) => a + s.minutes, 0);
    const days = new Set(plan.sessions.map((s) => s.date)).size;
    const box = $('stats');
    box.textContent = '';
    [
      [fmtMin(total), 'planned study'],
      [String(plan.sessions.length), 'sessions'],
      [String(days), 'study days'],
      [`${learnTotal ? Math.min(100, Math.round((done / learnTotal) * 100)) : 0}%`, 'of topics done'],
    ].forEach(([b, s]) => {
      const d = el('div', 'stat');
      d.append(el('b', null, b), el('span', null, s));
      box.append(d);
    });
  }

  function renderIssues() {
    const box = $('issues');
    box.textContent = '';
    for (const i of state.plan.check.issues) {
      box.append(el('div', `issue issue-${i.severity}`, `${i.severity === 'error' ? '⚠️' : 'ℹ️'} ${i.message}`));
    }
  }

  function renderBars() {
    const { plan } = state;
    const done = topicDone(plan);
    const today = localToday();
    const box = $('subjectBars');
    box.textContent = '';
    for (const s of plan.subjects) {
      const topics = plan.topics.filter((t) => t.subjectId === s.id);
      const total = topics.reduce((a, t) => a + t.hours * 60, 0);
      const d = topics.reduce((a, t) => a + (done.get(t.id) || 0), 0);
      const pct = total ? Math.min(100, Math.round((d / total) * 100)) : 0;
      const row = el('div', 'bar-row');
      const name = el('div', 'bar-name');
      const dot = el('span', 'dot');
      dot.style.background = s.color;
      name.append(dot, el('span', null, s.name));
      const track = el('div', 'track');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', String(pct));
      track.setAttribute('aria-label', `${s.name} progress`);
      const fill = el('div', 'fill');
      fill.style.width = `${pct}%`;
      fill.style.background = s.color;
      track.append(fill);
      const left = diffDays(today, s.examDate);
      const when = left > 1 ? `exam in ${left} days` : left === 1 ? 'exam tomorrow' : left === 0 ? 'exam today' : 'exam over';
      row.append(name, track, el('div', 'bar-meta', `${pct}% · ${when}`));
      box.append(row);
    }
  }

  function gcalUrl(s, subject, date, startMin) {
    const kind = s.type === 'learn' ? 'Study' : s.type === 'revise' ? 'Revise' : 'Mock test';
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: s.type === 'learn' ? `${kind}: ${s.title}` : s.title,
      dates: `${stampAt(date, startMin)}/${stampAt(date, startMin + s.minutes)}`,
      details: `${subject ? `${subject.name} · ` : ''}${fmtMin(s.minutes)} · from AI Study Planner Agent`,
    });
    return `https://calendar.google.com/calendar/render?${p.toString()}`;
  }

  function sessionRow(s, subject, date, startMin) {
    const row = el('div', `session${s.status === 'done' ? ' is-done' : ''}`);
    const dot = el('span', 'dot');
    dot.style.background = subject ? subject.color : '#8a86ab';
    const main = el('div', 's-main');
    main.append(el('div', 's-title', s.title));
    const meta = el('div', 's-meta');
    meta.append(
      el('span', `type type-${s.type}`, s.type === 'learn' ? 'Learn' : s.type === 'revise' ? 'Revise' : 'Mock test'),
      el('span', null, subject ? subject.name : ''),
      el('span', null, `${minToTime(startMin)} · ${fmtMin(s.minutes)}`),
    );
    main.append(meta);
    const actions = el('div', 's-actions');
    [
      ['done', '✓ Done', 'Done'],
      ['half', '½ Half', 'Half done'],
      ['missed', '✗ Missed', 'Missed'],
    ].forEach(([v, label, spoken]) => {
      const b = el('button', `mark m-${v}`, label);
      b.type = 'button';
      b.dataset.sid = s.id;
      b.dataset.v = v;
      b.setAttribute('aria-pressed', String(s.status === v));
      b.setAttribute('aria-label', `${spoken}: ${s.title}`);
      b.addEventListener('click', () => {
        s.status = s.status === v ? null : v;
        save();
        refresh();
        const again = document.querySelector(`button[data-sid="${s.id}"][data-v="${v}"]`);
        if (again) again.focus();
      });
      actions.append(b);
    });
    const a = el('a', 'gcal', '📅');
    a.href = gcalUrl(s, subject, date, startMin);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Add to Google Calendar';
    a.setAttribute('aria-label', `Add "${s.title}" to Google Calendar`);
    actions.append(a);
    row.append(dot, main, actions);
    return row;
  }

  function renderDays() {
    const { plan, input } = state;
    const box = $('days');
    box.textContent = '';
    const today = localToday();
    const subj = new Map(plan.subjects.map((s) => [s.id, s]));
    const byDate = new Map();
    plan.sessions.forEach((s) => {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    });
    const exams = new Map();
    plan.subjects.forEach((s) => {
      if (!exams.has(s.examDate)) exams.set(s.examDate, []);
      exams.get(s.examDate).push(s);
    });
    const dates = [...new Set([...byDate.keys(), ...exams.keys()])].sort();
    const earlier = el('details', 'earlier');
    earlier.append(el('summary', null, 'Earlier days'));
    let hasEarlier = false;
    const start = timeToMin(input.startTime);
    for (const d of dates) {
      const list = byDate.get(d) || [];
      const ex = exams.get(d) || [];
      const card = el('section', `day${d === today ? ' today' : ''}`);
      card.setAttribute('aria-label', fmtDay(d));
      const head = el('div', 'day-head');
      const h = el('h3', null, fmtDay(d));
      if (d === today) h.append(' ', el('span', 'chip today-chip', 'Today'));
      head.append(h);
      const tot = list.reduce((a, s) => a + s.minutes, 0);
      if (tot) head.append(el('span', 'day-total', fmtMin(tot)));
      card.append(head);
      ex.forEach((s) => card.append(el('div', 'exam', `🎯 Exam: ${s.name}`)));
      let clock = start;
      list.forEach((s) => {
        card.append(sessionRow(s, subj.get(s.subjectId), d, clock));
        clock += s.minutes + 10;
      });
      if (d < today) {
        earlier.append(card);
        hasEarlier = true;
      } else {
        box.append(card);
      }
    }
    if (hasEarlier) box.prepend(earlier);
    if (input.restDay !== 'none') {
      box.append(el('p', 'rest', `😌 ${input.restDay[0].toUpperCase()}${input.restDay.slice(1)}days are rest days.`));
    }
  }

  // --------------------------------------------------------------- export
  const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  function fold(line) {
    const out = [];
    let l = line;
    while (l.length > 73) {
      out.push(l.slice(0, 73));
      l = ` ${l.slice(73)}`;
    }
    out.push(l);
    return out.join('\r\n');
  }
  function downloadIcs() {
    const { plan, input } = state;
    const today = localToday();
    const subj = new Map(plan.subjects.map((s) => [s.id, s]));
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//P Om Shiva//AI Study Planner Agent//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Study plan'];
    const byDate = new Map();
    plan.sessions
      .filter((s) => s.date >= today)
      .forEach((s) => {
        if (!byDate.has(s.date)) byDate.set(s.date, []);
        byDate.get(s.date).push(s);
      });
    for (const [d, list] of byDate) {
      let clock = timeToMin(input.startTime);
      for (const s of list) {
        const subject = subj.get(s.subjectId);
        lines.push(
          'BEGIN:VEVENT',
          `UID:${s.id}@study-planner-agent`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${stampAt(d, clock)}`,
          `DTEND:${stampAt(d, clock + s.minutes)}`,
          `SUMMARY:${esc(s.type === 'learn' ? `Study: ${s.title}` : s.title)}`,
          `DESCRIPTION:${esc(`${subject ? subject.name : ''} · ${fmtMin(s.minutes)} · AI Study Planner Agent`)}`,
          'END:VEVENT',
        );
        clock += s.minutes + 10;
      }
    }
    for (const s of plan.subjects.filter((x) => x.examDate >= today)) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:exam-${s.id}-${s.examDate}@study-planner-agent`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${s.examDate.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${addDays(s.examDate, 1).replace(/-/g, '')}`,
        `SUMMARY:${esc(`Exam: ${s.name}`)}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([`${lines.map(fold).join('\r\n')}\r\n`], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'study-plan.ics';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  // ------------------------------------------------------------- check-in
  async function onReplan() {
    const { plan, input } = state;
    const from = addDays(localToday(), 1);
    const msg = $('replanMsg');
    const subjects = plan.subjects.filter((s) => s.examDate >= from);
    if (subjects.length === 0) {
      msg.textContent = 'All your exams are over. 🎉 Start a new plan for the next ones.';
      msg.hidden = false;
      return;
    }
    const ids = new Set(subjects.map((s) => s.id));
    const done = topicDone(plan);
    const topics = plan.topics
      .filter((t) => ids.has(t.subjectId))
      .map((t) => ({
        id: t.id,
        subjectId: t.subjectId,
        title: t.title,
        hours: t.hours,
        doneMinutes: Math.min(t.hours * 60, done.get(t.id) || 0),
        difficulty: t.difficulty,
        order: t.order,
      }));
    const btn = $('replanBtn');
    btn.disabled = true;
    msg.hidden = true;
    const rs = $('replanSteps');
    rs.hidden = false;
    rs.textContent = '';
    rs.append(stepItem({ phase: 'CHECK', text: 'Looking at what you finished…' }));
    try {
      const res = await post('/api/replan', {
        name: input.name,
        fromDate: from,
        hoursPerDay: input.hoursPerDay,
        restDay: input.restDay,
        subjects: subjects.map(({ id, name, examDate, confidence }) => ({ id, name, examDate, confidence })),
        topics,
        options: plan.options,
      });
      const keep = plan.sessions.filter((s) => s.date < from || s.status === 'done' || s.status === 'half');
      const byId = new Map(plan.topics.map((t) => [t.id, t]));
      res.topics.forEach((t) => {
        if (byId.has(t.id)) byId.set(t.id, { ...byId.get(t.id), hours: t.hours });
      });
      plan.topics = [...byId.values()];
      plan.sessions = [...keep, ...res.sessions.map((s) => ({ ...s, id: newId(), status: null }))].sort((a, b) => a.date.localeCompare(b.date));
      plan.check = res.check;
      plan.lastReplan = { at: new Date().toISOString(), steps: res.steps, message: res.message, mode: res.mode };
      save();
      await playSteps(rs, res.steps, 300);
      msg.textContent = res.message;
      msg.hidden = false;
      refresh();
    } catch (ex) {
      rs.hidden = true;
      msg.textContent = ex.message;
      msg.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function newPlan() {
    if (!window.confirm('Start a new plan? Your current plan will be replaced.')) return;
    state.plan = null;
    save();
    $('planView').hidden = true;
    $('replanSteps').hidden = true;
    $('replanMsg').hidden = true;
    $('hero').hidden = false;
    $('setup').hidden = false;
    fillForm(state.input || {});
    $('setupTitle').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }

  // ----------------------------------------------------------------- init
  $('hours').addEventListener('input', updateHours);
  $('addSubject').addEventListener('click', () => {
    const node = addSubject();
    if (node) node.querySelector('.s-name').focus();
  });
  $('fillExample').addEventListener('click', fillExample);
  $('planForm').addEventListener('submit', onSubmit);
  $('icsBtn').addEventListener('click', downloadIcs);
  $('printBtn').addEventListener('click', () => window.print());
  $('newBtn').addEventListener('click', newPlan);
  $('replanBtn').addEventListener('click', onReplan);
  $('startDate').min = localToday();

  if (state.input) fillForm(state.input);
  else {
    $('startDate').value = localToday();
    updateHours();
    addSubject();
  }
  if (state.plan) showPlan(false);
})();
