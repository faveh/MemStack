// Show Me held-out exam: next-action questions on the demo sites (Trattoria Nove, Tubely),
// sent through Mubit exactly as the live agent sends them (same system prompt, message
// builder, model and request body), so they land in the live "next-action" task.
//
//   node exam/showme/run.js --probe            # 2 live-style calls (recorded, as the live agent): who answers?
//   node exam/showme/run.js --route provider   # held-out exam now, recording off (x-middleware-record: metadata)
//   node exam/showme/run.js --route routed     # the same exam later, once an adapter is Live: Mubit picks
//
// Options: --limit N, --concurrency 3, --model claude-haiku-4-5.
// We never force the adapter: both routes send the same call. Mubit decides who answers;
// the x-middleware-served-by header (contains "vllm") says it was the adapter.
// Output goes to $SHOWME_EXAM_DIR (default exam/showme/data/, gitignored): calls-<route>.jsonl,
// results-<route>.json, probe-<epoch>.json and spend.jsonl.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { SYSTEM_PROMPTS, TASKS, buildNextActionMessage } from '../../server/prompts.js';
import { anthropicBody, parseJson } from '../../server/llm.js';
import { costUsd } from '../prices.js';
import { QUESTIONS } from './heldout.js';
import { scoreAnswer, servedBy, summarize } from './score.js';
import { trattoria, trattoriaLesson } from './pages.js';

const OUT = process.env.SHOWME_EXAM_DIR || path.join(import.meta.dirname, 'data');
const SPEND_FILE = path.join(OUT, 'spend.jsonl');
const BASE = 'https://api.mubit.ai';
// Hard cap on estimated spend for this exam plus the seed calls logged in $SHOWME_DATA_DIR.
export const BUDGET_USD = 2;
const SYSTEM = SYSTEM_PROMPTS[TASKS.nextAction];

let cachedKey;
function apiKey() {
  if (cachedKey) return cachedKey;
  cachedKey = process.env.MUBIT_API_KEY
    || execFileSync('security', ['find-generic-password', '-s', 'mubit-api-key', '-w'], { encoding: 'utf8' }).trim();
  if (!cachedKey) throw new Error('No Mubit key: set MUBIT_API_KEY or add mubit-api-key to the keychain');
  return cachedKey;
}

function sumJsonl(file, field) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .reduce((sum, line) => { try { return sum + (JSON.parse(line)[field] || 0); } catch { return sum; } }, 0);
}

// Exam spend plus the seed's own ledger (server/ledger.js writes costUsd per call).
export function spentUsd() {
  const seed = process.env.SHOWME_DATA_DIR ? sumJsonl(path.join(process.env.SHOWME_DATA_DIR, 'calls.jsonl'), 'costUsd') : 0;
  return sumJsonl(SPEND_FILE, 'usd') + seed;
}

class BudgetError extends Error {}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One gateway call with backoff on 429 and 5xx. record = null sends no x-middleware-record
// header, as the live agent does. Never logs the key.
async function send({ model, userMessage, sessionId, record }) {
  for (let attempt = 0; ; attempt++) {
    if (spentUsd() >= BUDGET_USD) throw new BudgetError(`budget cap $${BUDGET_USD} reached ($${spentUsd().toFixed(3)} spent)`);
    const started = Date.now();
    let res, text;
    try {
      res = await fetch(`${BASE}/anthropic/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01',
          ...(record ? { 'x-middleware-record': record } : {}),
        },
        body: JSON.stringify(anthropicBody(model, SYSTEM, userMessage, sessionId)),
        signal: AbortSignal.timeout(90_000),
      });
      text = await res.text();
    } catch (err) {
      if (attempt < 5) { await sleep(2000 * 2 ** attempt); continue; }
      throw err;
    }
    const ms = Date.now() - started;
    const headers = Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('x-middleware-') || k === 'retry-after'));
    if ((res.status === 429 || res.status >= 500) && attempt < 8) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || Math.min(30_000, 1500 * 2 ** attempt);
      await sleep(wait + Math.random() * 500);
      continue;
    }
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) return { ok: false, status: res.status, ms, headers, error: (data?.error?.message || text).slice(0, 300) };
    const reply = {
      text: (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(''),
      inTokens: data.usage?.input_tokens || 0, outTokens: data.usage?.output_tokens || 0,
    };
    const usd = costUsd(model, reply.inTokens, reply.outTokens);
    fs.appendFileSync(SPEND_FILE, JSON.stringify({ ts: Date.now(), model, usd }) + '\n');
    return { ok: true, status: res.status, ms, headers, usd, ...reply };
  }
}

async function pool(items, concurrency, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export function messageFor(q) {
  return buildNextActionMessage({ goal: q.goal, page: q.page, history: q.history, demo: q.demo || undefined });
}

export async function runExam(route, { model = 'claude-haiku-4-5', limit, concurrency = 3, log = console.error } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const questions = limit ? QUESTIONS.slice(0, limit) : QUESTIONS;
  const rows = [];
  let stopped = null;
  await pool(questions, concurrency, async q => {
    if (stopped) return;
    let r;
    try { r = await send({ model, userMessage: messageFor(q), sessionId: `exam-showme-${route}-${q.id}`, record: 'metadata' }); }
    catch (err) {
      if (err instanceof BudgetError) { stopped = err.message; return; }
      r = { ok: false, error: err.message };
    }
    const answer = r.ok ? parseJson(r.text) : null;
    rows.push({
      id: q.id, site: q.site, variant: q.variant, route, model, ok: !!r.ok, status: r.status, error: r.error,
      ms: r.ms, inTokens: r.inTokens, outTokens: r.outTokens, cost: r.ok ? r.usd : 0,
      headers: r.headers, ...servedBy(r.headers), answer, expected: q.expected, ...scoreAnswer(answer, q.expected),
    });
    if (rows.length % 10 === 0) log(`${route}: ${rows.length}/${questions.length}, spend $${spentUsd().toFixed(3)}`);
  });
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const groups = { all: rows, trattoria: rows.filter(r => r.site === 'trattoria'), tubely: rows.filter(r => r.site === 'tubely'), 'held-out variants': rows.filter(r => r.variant === 'variant') };
  const result = { route, model, at: new Date().toISOString(), stopped, spentUsd: spentUsd(), summary: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, summarize(v)])) };
  fs.writeFileSync(path.join(OUT, `calls-${route}.jsonl`), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, `results-${route}.json`), JSON.stringify(result, null, 2));
  return result;
}

// Two next-action calls shaped like the live agent's first steps on Trattoria Nove (seed-style
// goal, not a held-out one), sent with no x-middleware-record header, as the agent sends them.
export async function probe({ model = 'claude-haiku-4-5', log = console.log } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const goal = 'Book a table for two at eight';
  const calls = [
    { goal, page: trattoria({ dialog: true }), history: [] },
    { goal, page: trattoria(), history: [{ action: 'click', label: 'No thanks', role: 'button', value: '' }], demo: trattoriaLesson() },
  ];
  const results = [];
  for (const [i, c] of calls.entries()) {
    const r = await send({ model, userMessage: messageFor(c), sessionId: `probe-showme-${Date.now()}-${i}`, record: null });
    const by = servedBy(r.headers);
    results.push({ ok: r.ok, status: r.status, ms: r.ms, adapter: by.adapter, version: by.version, headers: r.headers, answer: r.ok ? parseJson(r.text) : null, error: r.error });
    log(`probe ${i + 1}: ${r.ok ? 'ok' : `HTTP ${r.status} ${r.error}`} ${r.ms} ms, served by ${by.adapter ? `ADAPTER (version=${by.version})` : 'provider'}; x-middleware headers: ${JSON.stringify(r.headers)}`);
  }
  fs.writeFileSync(path.join(OUT, `probe-${Date.now()}.json`), JSON.stringify(results, null, 2));
  return results;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { route: { type: 'string' }, probe: { type: 'boolean' }, limit: { type: 'string' }, concurrency: { type: 'string' }, model: { type: 'string' } } });
  const model = values.model || 'claude-haiku-4-5';
  if (values.probe) await probe({ model });
  else if (values.route === 'provider' || values.route === 'routed') {
    const result = await runExam(values.route, { model, limit: values.limit ? Number(values.limit) : undefined, concurrency: values.concurrency ? Number(values.concurrency) : 3 });
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Usage: node exam/showme/run.js --probe | --route provider|routed [--limit N] [--concurrency 3] [--model claude-haiku-4-5]');
    process.exit(2);
  }
}
