'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createHandlers, createRateLimiter } = require('../src/http');

function today() {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(n) {
  return new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
}

async function withServer(handlers, fn) {
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/api/plan') return handlers.plan(req, res);
    if (p === '/api/replan') return handlers.replan(req, res);
    if (p === '/api/status') return handlers.status(req, res);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const body = () => ({
  name: 'Om',
  startDate: today(),
  hoursPerDay: 3,
  restDay: 'sun',
  subjects: [{ name: 'DBMS', examDate: plusDays(15), confidence: 'ok', syllabus: 'Unit 1: ER model\nUnit 2: SQL' }],
});

const post = (base, p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) });

test('api: status, plan, replan and errors (rule-based mode)', async () => {
  await withServer(createHandlers({ model: null }), async (base) => {
    const st = await fetch(`${base}/api/status`);
    assert.equal(st.status, 200);
    assert.deepEqual(await st.json(), { ai: false });
    assert.match(st.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(st.headers.get('x-frame-options'), 'DENY');

    const res = await post(base, '/api/plan', body());
    assert.equal(res.status, 200);
    const plan = await res.json();
    assert.ok(plan.sessions.length > 0);
    assert.equal(plan.mode, 'rules');

    const rep = await post(base, '/api/replan', {
      name: 'Om',
      fromDate: plusDays(1),
      hoursPerDay: 2,
      restDay: 'none',
      subjects: plan.subjects,
      topics: plan.topics,
      options: plan.options,
    });
    assert.equal(rep.status, 200);
    const replan = await rep.json();
    assert.ok(replan.sessions.every((s) => s.date >= plusDays(1)));

    const bad = await post(base, '/api/plan', { ...body(), hoursPerDay: 99 });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error.message, /hours/);

    const broken = await post(base, '/api/plan', '{not json');
    assert.equal(broken.status, 400);

    const huge = await post(base, '/api/plan', { ...body(), filler: 'x'.repeat(40000) });
    assert.equal(huge.status, 413);

    const get = await fetch(`${base}/api/plan`);
    assert.equal(get.status, 405);
  });
});

test('api: rate limit answers 429', async () => {
  const handlers = createHandlers({ model: null, limiter: createRateLimiter({ windowMs: 60000, max: 1 }) });
  await withServer(handlers, async (base) => {
    assert.equal((await post(base, '/api/plan', body())).status, 200);
    assert.equal((await post(base, '/api/plan', body())).status, 429);
  });
});

test('frontend: no innerHTML, labelled inputs, no inline scripts', () => {
  const pub = path.join(__dirname, '..', 'public');
  const js = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(/.test(js), 'AI text is only set with textContent');
  assert.ok(!/<script>(?!\s*<\/script>)/.test(html) && !/ on[a-z]+="/.test(html), 'no inline scripts or handlers');
  assert.ok(/<html lang="en">/.test(html));
  assert.ok(/aria-live="polite"/.test(html), 'agent steps are announced');
  assert.ok(/class="skip"/.test(html), 'skip link');
});
