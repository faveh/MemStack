// Scorer and held-out set tests. No network: run with `node --test exam/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { matches, median, scoreAnswer, servedBy, summarize } from './score.js';
import { HELD_OUT, QUESTIONS } from './heldout.js';
import { messageFor } from './run.js';

test('matches checks action, element and value', () => {
  const exp = { action: 'select', element_ids: ['e3'], value: '7' };
  assert.equal(matches({ action: 'select', element_id: 'e3', value: '7' }, exp), true);
  assert.equal(matches({ action: 'SELECT', element_id: ' e3 ', value: ' 7 ' }, exp), true);
  assert.equal(matches({ action: 'select', element_id: 'e4', value: '7' }, exp), false);
  assert.equal(matches({ action: 'select', element_id: 'e3', value: '6' }, exp), false);
  assert.equal(matches({ action: 'click', element_id: 'e3' }, exp), false);
  assert.equal(matches(null, exp), false);
});

test('matches leaves out fields the expectation does not name', () => {
  assert.equal(matches({ action: 'done', element_id: 'e9', value: 'x' }, { action: 'done' }), true);
  assert.equal(matches({ action: 'ask_human', value: 'Which sitting is at 20:00?' }, { action: 'ask_human' }), true);
});

test('value_match is a case-insensitive regex', () => {
  const exp = { action: 'open_url', value_match: '^http://localhost:8787/demo/tube/results\\.html\\?q=Little(%20|\\+| )Simz$' };
  assert.equal(matches({ action: 'open_url', value: 'http://localhost:8787/demo/tube/results.html?q=little%20simz' }, exp), true);
  assert.equal(matches({ action: 'open_url', value: 'http://localhost:8787/demo/tube/results.html?q=Little+Simz' }, exp), true);
  assert.equal(matches({ action: 'open_url', value: 'https://www.youtube.com/results?search_query=Little+Simz' }, exp), false);
});

test('scoreAnswer accepts any listed action and reports a right action with a wrong target', () => {
  const list = [{ action: 'select', element_ids: ['e3'], value: '4' }, { action: 'type', element_ids: ['e9'], value: 'Chidi' }];
  assert.deepEqual(scoreAnswer({ action: 'type', element_id: 'e9', value: 'chidi' }, list), { correct: true, actionOk: true });
  assert.deepEqual(scoreAnswer({ action: 'type', element_id: 'e3', value: 'Chidi' }, list), { correct: false, actionOk: true });
  assert.deepEqual(scoreAnswer({ action: 'done' }, list), { correct: false, actionOk: false });
  assert.deepEqual(scoreAnswer(null, list), { correct: false, actionOk: false });
});

test('servedBy reads the adapter from x-middleware-served-by', () => {
  assert.deepEqual(servedBy({ 'x-middleware-served-by': 'vllm; version=3' }), { adapter: true, version: '3' });
  assert.deepEqual(servedBy({ 'x-middleware-request-id': 'mreq_1' }), { adapter: false, version: null });
  assert.deepEqual(servedBy(undefined), { adapter: false, version: null });
});

test('summarize: accuracy over all questions, cost per 1,000 with adapter calls at 5%', () => {
  const rows = [
    { ok: true, correct: true, ms: 100, cost: 0.001, adapter: false },
    { ok: true, correct: false, ms: 300, cost: 0.001, adapter: true, version: '2' },
    { ok: false, correct: false, cost: 0 },
  ];
  const s = summarize(rows);
  assert.equal(s.accuracy, 1 / 3);
  assert.equal(s.medianMs, 200);
  assert.ok(Math.abs(s.usdPer1000 - ((0.001 + 0.00005) / 2) * 1000) < 1e-9);
  assert.equal(s.adapterShare, 0.5);
  assert.deepEqual(s.versions, ['2']);
  assert.equal(median([]), null);
});

test('every held-out question is well formed and its expected elements exist on its page', () => {
  const ids = new Set();
  for (const q of QUESTIONS) {
    assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
    ids.add(q.id);
    assert.ok(q.expected.length > 0, q.id);
    const onPage = new Set(q.page.elements.map(e => e.id));
    for (const e of q.expected) for (const id of e.element_ids || []) assert.ok(onPage.has(id), `${q.id}: ${id} not on the page`);
    assert.match(messageFor(q), /^Goal: /);
  }
  assert.ok(QUESTIONS.some(q => q.variant === 'variant'));
});

test('the seed script uses none of the held-out names, artists or page variants', () => {
  const seed = fs.readFileSync(path.resolve(import.meta.dirname, '../../scripts/seed-traffic.js'), 'utf8');
  for (const word of [...HELD_OUT.names, ...HELD_OUT.artists, HELD_OUT.error]) assert.ok(!seed.includes(word), `seed mentions ${word}`);
  assert.ok(!/tubelyResults\('music'\)|error:/.test(seed), 'seed builds a held-out page variant');
});
