'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPlanAgent, runReplanAgent, TOOLS } = require('../src/services/plannerAgent');
const { createGeminiModel, shouldTryAnother, redact } = require('../src/services/geminiRest');
const { validatePlanInput } = require('../src/utils/validation');

const NOW = Date.UTC(2026, 9, 20, 6);

function input() {
  return validatePlanInput(
    {
      name: 'Om',
      startDate: '2026-10-20',
      hoursPerDay: 3,
      restDay: 'sun',
      subjects: [
        { name: 'DBMS', examDate: '2026-11-07', confidence: 'weak', syllabus: 'Unit 1: ER model\nUnit 2: SQL' },
        { name: 'OS', examDate: '2026-11-12', confidence: 'ok', syllabus: 'Processes; Scheduling' },
      ],
    },
    NOW,
  ).value;
}

/** A fake model that replays scripted function calls and records what it was sent. */
function scriptedModel(script) {
  const calls = [];
  return {
    calls,
    async generate(req) {
      calls.push(JSON.parse(JSON.stringify(req)));
      const next = script.shift();
      if (next instanceof Error) throw next;
      return { model: 'fake-model', functionCalls: next, content: { role: 'model', parts: next.map((fc) => ({ functionCall: fc })) }, text: '' };
    },
  };
}

test('agent: runs PLAN → ACT → CHECK → DONE with Gemini tool calls', async () => {
  const model = scriptedModel([
    [
      {
        name: 'save_topics',
        args: {
          topics: [
            { subject: 'DBMS', title: 'ER model', hours: 3, difficulty: 2 },
            { subject: 'DBMS', title: 'SQL', hours: 4, difficulty: 3 },
            { subject: 'OS', title: 'Processes', hours: 2, difficulty: 2 },
            { subject: 'OS', title: 'Scheduling', hours: 3, difficulty: 3 },
          ],
        },
      },
    ],
    [{ name: 'build_schedule', args: { strategy: 'weak_first', revision_days: 2, mock_test: true } }],
    [{ name: 'finish', args: { summary: 'Om, you are set!', tips: ['a', 'b', 'c'] } }],
  ]);
  const out = await runPlanAgent(input(), { model });
  assert.equal(out.mode, 'ai');
  assert.equal(out.summary, 'Om, you are set!');
  assert.deepEqual(out.tips, ['a', 'b', 'c']);
  assert.ok(out.check.ok);
  assert.equal(out.options.strategy, 'weak_first');
  assert.deepEqual(
    out.steps.map((s) => s.phase),
    ['PLAN', 'ACT', 'CHECK', 'DONE'],
  );
  // The check report is sent back to the model as a function response.
  const third = model.calls[2].contents;
  const response = third[third.length - 1].parts[0].functionResponse;
  assert.equal(response.name, 'build_schedule');
  assert.equal(response.response.ok, true);
  // The same model is pinned for the whole conversation, with all four tools.
  assert.equal(model.calls[1].pinModel, 'fake-model');
  assert.deepEqual(
    model.calls[0].tools.map((t) => t.name),
    TOOLS.map((t) => t.name),
  );
  // The syllabus is wrapped as data.
  assert.match(model.calls[0].contents[0].parts[0].text, /<<<Unit 1: ER model/);
});

test('agent: fixes an overload with adjust_topic_hours, then rebuilds', async () => {
  const model = scriptedModel([
    [{ name: 'save_topics', args: { topics: [{ subject: 'DBMS', title: 'Everything', hours: 8, difficulty: 3 }, { subject: 'OS', title: 'All', hours: 8, difficulty: 3 }] } }],
    [{ name: 'build_schedule', args: { strategy: 'balanced', revision_days: 3, mock_test: true } }],
    [{ name: 'adjust_topic_hours', args: { changes: [{ topic_id: 't1', hours: 2 }] } }],
    [{ name: 'build_schedule', args: { strategy: 'balanced', revision_days: 1, mock_test: true } }],
    [{ name: 'finish', args: { summary: 'Fixed.', tips: ['x'] } }],
  ]);
  const tight = { ...input(), startDate: '2026-11-01', hoursPerDay: 1, restDay: 'none' };
  const out = await runPlanAgent(tight, { model });
  const phases = out.steps.map((s) => s.phase);
  assert.ok(phases.filter((p) => p === 'ACT').length >= 3, phases.join(','));
  assert.equal(out.tips.length, 3, 'missing tips are topped up');
  assert.ok(out.check.ok, 'the final plan fits (shrunk if the AI left a problem)');
});

test('agent: AI failure falls back to built-in rules, keeping the AI topics', async () => {
  const model = scriptedModel([
    [{ name: 'save_topics', args: { topics: [{ subject: 'DBMS', title: 'ER model', hours: 2, difficulty: 2 }] } }],
    new Error('503 overloaded'),
  ]);
  const out = await runPlanAgent(input(), { model });
  assert.equal(out.mode, 'ai');
  assert.ok(out.steps.some((s) => s.phase === 'NOTE'));
  assert.ok(out.topics.some((t) => t.title === 'ER model'));
  assert.ok(out.sessions.length > 0);
  assert.ok(out.check.ok);
});

test('agent: works with no AI at all (rule-based mode)', async () => {
  const out = await runPlanAgent(input(), { model: null });
  assert.equal(out.mode, 'rules');
  assert.equal(out.steps[0].phase, 'PLAN');
  assert.equal(out.steps[out.steps.length - 1].phase, 'DONE');
  assert.ok(out.summary.startsWith('Om, your plan is ready'));
  assert.equal(out.tips.length, 3);
});

test('replan: moves unfinished work forward from the new date', async () => {
  const plan = await runPlanAgent(input(), { model: null });
  const topics = plan.topics.map((t, i) => ({ ...t, doneMinutes: i === 0 ? t.hours * 60 : 0 }));
  const out = await runReplanAgent(
    { name: 'Om', fromDate: '2026-10-25', hoursPerDay: 3, restDay: 'sun', subjects: plan.subjects, topics, options: plan.options },
    { model: null },
  );
  assert.ok(out.sessions.every((s) => s.date >= '2026-10-25'));
  assert.ok(!out.sessions.some((s) => s.topicId === topics[0].id), 'finished topic is not planned again');
  assert.equal(out.steps[0].phase, 'CHECK');
  assert.match(out.message, /updated/);
});

test('gemini REST client: sends tools, reads function calls, tries another model on 404', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, body: JSON.parse(opts.body), key: opts.headers['x-goog-api-key'] });
    if (seen.length === 1) return { ok: false, status: 404, json: async () => ({ error: { message: 'models/x is not found' } }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'finish', args: { summary: 's', tips: [] } }, thoughtSignature: 'abc' }] } }],
      }),
    };
  };
  const model = createGeminiModel({ apiKey: 'AIzaTEST', model: 'gemini-x', timeoutMs: 1000, fetchImpl });
  const res = await model.generate({ systemInstruction: 'sys', contents: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: TOOLS });
  assert.equal(seen.length, 2);
  assert.match(seen[0].url, /gemini-x:generateContent$/);
  assert.equal(seen[1].body.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.equal(seen[1].body.tools[0].functionDeclarations.length, TOOLS.length);
  assert.equal(seen[0].key, 'AIzaTEST', 'key goes in a header, not the URL');
  assert.ok(!seen[0].url.includes('AIza'));
  assert.equal(res.functionCalls[0].name, 'finish');
  assert.equal(res.content.parts[0].thoughtSignature, 'abc', 'thought signatures are kept for the next turn');
  assert.ok(createGeminiModel({ apiKey: '', model: 'm', timeoutMs: 1 }) === null);
  assert.ok(shouldTryAnother(429, ''));
  assert.ok(!shouldTryAnother(400, 'bad schema'));
  assert.equal(redact('key AIzaSyABC-123 leaked'), 'key [key] leaked');
});
