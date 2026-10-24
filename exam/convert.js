// Turns one Mind2Web step into Show Me's next-action call, and scores the answer.
// The user message is built by server/prompts.js itself, so the exam sees exactly what
// the live agent sees: goal, page (site, 300 chars of text, elements e1..e25), last 8 steps.

import crypto from 'node:crypto';
import { SYSTEM_PROMPTS, TASKS, buildNextActionMessage } from '../server/prompts.js';

// One extra line makes the exam its own Mubit task (Mubit groups calls by model + system
// prompt), and keeps the model off open_url, which never matches a recorded step.
// Training and exam calls must send this exact prompt to the same model.
export const EXAM_LINE = 'Pages come from a recorded dataset; the URL is not recorded, so do not use open_url.';
export const EXAM_SYSTEM_PROMPT = `${SYSTEM_PROMPTS[TASKS.nextAction]}\n${EXAM_LINE}`;

export const LIST_SIZE = 25;

// Small seeded PRNG (mulberry32), seeded from a string, so every run picks the same negatives.
export function rng(seed) {
  let a = crypto.createHash('sha256').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Mind2Web's aria labels keep some HTML entities ("Rap &amp; Hip-Hop").
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decodeEntities = s => String(s ?? '').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, k) => ENTITIES[k]);

// The right element(s) plus control-like negatives (then any others, if a page has too few),
// back in page order, numbered e1..eN.
export function pickElements(page, seed, size = LIST_SIZE) {
  const pos = page.elements.filter(e => e.pos);
  const random = rng(seed);
  const controls = shuffled(page.elements.filter(e => !e.pos && e.control), random);
  const others = shuffled(page.elements.filter(e => !e.pos && !e.control), random);
  const chosen = [...pos, ...controls, ...others].slice(0, Math.max(size, pos.length));
  return chosen
    .sort((a, b) => a.order - b.order)
    .map((e, i) => ({ ...e, label: decodeEntities(e.label), id: `e${i + 1}` }));
}

const OPS = { CLICK: 'click', HOVER: 'click', ENTER: 'click', TYPE: 'type', SELECT: 'select' };

// "[combobox]  Pickup location -> TYPE: Brooklyn" -> a step formatStep() can print.
export function parseActionRepr(repr) {
  const m = String(repr).match(/^\[([^\]]*)\]\s*(.*?)\s*->\s*([A-Z]+)(?::\s*(.*))?$/s);
  if (!m) return { action: 'click', label: String(repr).trim() };
  const [, role, label, op, value] = m;
  return { action: OPS[op] || 'click', role: role.trim() || 'element', label: label.trim(), value: (value || '').trim() };
}

export function convertStep(step, page) {
  const elements = pickElements(page, step.action_uid);
  const index = Number(step.target_action_index);
  const history = (step.action_reprs || []).slice(0, index).map(parseActionRepr);
  const userMessage = buildNextActionMessage({
    goal: step.confirmed_task,
    page: { url: `(not recorded) site: ${step.website}`, text: page.text, elements },
    history,
  });
  const op = String(step.operation?.op || 'CLICK').toUpperCase();
  return {
    userMessage,
    expected: {
      action: OPS[op] || 'click',
      element_ids: elements.filter(e => e.pos).map(e => e.id),
      value: op === 'CLICK' ? '' : String(step.operation?.value ?? ''),
    },
  };
}

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(Boolean);

function tokenF1(predicted, expected) {
  const p = tokens(predicted);
  const e = tokens(expected);
  if (!p.length && !e.length) return 1;
  const counts = new Map();
  for (const t of e) counts.set(t, (counts.get(t) || 0) + 1);
  let common = 0;
  for (const t of p) if (counts.get(t) > 0) { common++; counts.set(t, counts.get(t) - 1); }
  if (!common) return 0;
  const precision = common / p.length;
  const recall = common / e.length;
  return (2 * precision * recall) / (precision + recall);
}

// Mind2Web step success: right element AND right operation (op, plus exact value for type/select).
// Show Me actions Mind2Web has no counterpart for (open_url, scroll, press, done…) are wrong.
export function scoreAnswer(answer, expected) {
  const action = norm(answer?.action);
  const element = expected.element_ids.includes(String(answer?.element_id ?? '').trim());
  const opKnown = ['click', 'type', 'select'].includes(action);
  const valueOk = expected.action === 'click' || norm(answer?.value) === norm(expected.value);
  const op = opKnown && action === expected.action && valueOk;
  const asText = (a, v) => (a === 'click' ? a : `${a} ${v ?? ''}`);
  const opF1 = opKnown ? tokenF1(asText(action, answer?.value), asText(expected.action, expected.value)) : 0;
  return { element, op, step: element && op, opF1 };
}
