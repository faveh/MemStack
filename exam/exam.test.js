// Converter and scorer tests. No network: run with `node --test exam/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SYSTEM_PROMPTS } from '../server/prompts.js';
import { EXAM_LINE, EXAM_SYSTEM_PROMPT, convertStep, decodeEntities, parseActionRepr, pickElements, scoreAnswer } from './convert.js';
import { servedBy } from './run.js';
import { costUsd } from './prices.js';

// A train-split step (Mind2Web train data may be shown; never put test-split rows here).
const step = {
  action_uid: 'b64c2417-c44e-46c4-bb0b-ff1775e7da29',
  annotation_id: 'task-1',
  confirmed_task: 'rent a car in Brooklyn - Central, NY on from April 9 to April 15.',
  website: 'united',
  operation: { op: 'TYPE', original_op: 'TYPE', value: 'Brooklyn Central' },
  action_reprs: ['[heading]  CAR -> CLICK', '[combobox]  Enter pick up city -> TYPE: Brooklyn Central'],
  target_action_index: '1',
};

function page(negatives = 40) {
  const elements = [{ bid: '9947', tag: 'input', role: 'combobox', label: 'Pickup location*', pos: true, order: 50, control: true }];
  for (let i = 0; i < negatives; i++) {
    elements.push({ bid: `n${i}`, tag: 'a', role: 'link', label: `Link ${i} &amp; more`, pos: false, order: i * 3, control: true });
  }
  elements.push({ bid: 'div1', tag: 'div', role: 'div', label: 'div', pos: false, order: 1, control: false });
  return { text: 'Welcome to United.com Skip to book', elements };
}

test('exam system prompt is the next-action prompt plus one exam line', () => {
  assert.equal(EXAM_SYSTEM_PROMPT, `${SYSTEM_PROMPTS['next-action']}\n${EXAM_LINE}`);
  // Training and exam calls must share this prompt: changing it starts a new Mubit task.
  assert.equal(crypto.createHash('sha256').update(EXAM_SYSTEM_PROMPT).digest('hex').slice(0, 16), '27acdcd9287f3ede');
});

test('picks the right element plus 24 control-like negatives, in page order, same every run', () => {
  const a = pickElements(page(), 'seed-1');
  const b = pickElements(page(), 'seed-1');
  assert.equal(a.length, 25);
  assert.deepEqual(a, b);
  assert.equal(a.filter(e => e.pos).length, 1);
  assert.ok(a.every(e => e.control), 'non-controls only fill in when controls run out');
  assert.deepEqual(a.map(e => e.id), Array.from({ length: 25 }, (_, i) => `e${i + 1}`));
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].order <= a[i].order);
  assert.notDeepEqual(pickElements(page(), 'seed-2').map(e => e.bid), a.map(e => e.bid));
});

test('a page with few controls fills the list with other elements', () => {
  const list = pickElements(page(3), 'x');
  assert.equal(list.length, 5);
  assert.ok(list.some(e => e.bid === 'div1'));
});

test('labels lose HTML entities', () => {
  assert.equal(decodeEntities('Rap &amp; Hip-Hop &quot;x&quot;'), 'Rap & Hip-Hop "x"');
  assert.ok(pickElements(page(), 's').every(e => !e.label.includes('&amp;')));
});

test('action_reprs become Show Me steps', () => {
  assert.deepEqual(parseActionRepr('[combobox]  Enter pick up city -> TYPE: Brooklyn Central'),
    { action: 'type', role: 'combobox', label: 'Enter pick up city', value: 'Brooklyn Central' });
  assert.equal(parseActionRepr('[button]  Reservations -> HOVER').action, 'click');
  assert.equal(parseActionRepr('[select]  Time -> SELECT: 2:30 PM').action, 'select');
  assert.equal(parseActionRepr('[span]   -> CLICK').label, '');
});

test('converted message has Show Me\'s next-action shape', () => {
  const { userMessage, expected } = convertStep(step, page());
  assert.match(userMessage, /^Goal: rent a car in Brooklyn/);
  assert.match(userMessage, /\nURL: \(not recorded\) site: united\nText: Welcome to United\.com/);
  assert.match(userMessage, /\nElements:\ne1 /);
  assert.match(userMessage, /\nSteps already taken:\n1\. click heading "CAR"\n/);
  assert.doesNotMatch(userMessage, /Brooklyn Central"/, 'the step being asked must not leak into history');
  assert.match(userMessage, /Answer with one JSON object only\.$/);
  assert.equal(expected.action, 'type');
  assert.equal(expected.value, 'Brooklyn Central');
  assert.equal(expected.element_ids.length, 1);
  assert.match(userMessage, new RegExp(`${expected.element_ids[0]} combobox "Pickup location\\*"`));
});

test('step success needs the right element and the right operation', () => {
  const expected = { action: 'type', element_ids: ['e4'], value: '08817' };
  assert.deepEqual(scoreAnswer({ action: 'type', element_id: 'e4', value: ' 08817 ' }, expected), { element: true, op: true, step: true, opF1: 1 });
  assert.deepEqual(scoreAnswer({ action: 'click', element_id: 'e4' }, expected), { element: true, op: false, step: false, opF1: 0 });
  const partial = scoreAnswer({ action: 'type', element_id: 'e5', value: 'Brooklyn - Central, NY' }, { action: 'type', element_ids: ['e5'], value: 'Brooklyn Central' });
  assert.equal(partial.step, false);
  assert.ok(partial.opF1 > 0 && partial.opF1 < 1);
  assert.equal(scoreAnswer({ action: 'open_url', value: 'https://x' }, expected).opF1, 0);
  assert.equal(scoreAnswer(null, expected).step, false);
});

test('a click ignores the value; any right element counts', () => {
  const expected = { action: 'click', element_ids: ['e2', 'e9'], value: '' };
  assert.equal(scoreAnswer({ action: 'click', element_id: 'e9', value: 'whatever' }, expected).step, true);
  assert.equal(scoreAnswer({ action: 'click', element_id: 'e3' }, expected).step, false);
  assert.equal(scoreAnswer({ action: 'select', element_id: 'e2', value: 'x' }, expected).op, false);
});

test('adapter share reads x-middleware-served-by', () => {
  assert.deepEqual(servedBy({ 'x-middleware-request-id': 'mreq_1' }), { adapter: false, version: null });
  assert.deepEqual(servedBy({ 'x-middleware-served-by': 'vllm; version=3' }), { adapter: true, version: '3' });
  assert.deepEqual(servedBy({ 'x-middleware-served-by': 'vllm', 'x-middleware-pathway': 'route=adapter; version=2' }), { adapter: true, version: '2' });
  assert.equal(servedBy({ 'x-middleware-served-by': 'anthropic' }).adapter, false);
});

test('list prices', () => {
  assert.equal(costUsd('claude-sonnet-5-5', 1_000_000, 0), 2);
  assert.equal(costUsd('gpt-6-luna', 0, 1_000_000), 0.5);
});
