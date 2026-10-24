// Mind2Web exam runner. Sends converted steps through Mubit's gateway and logs every answer.
//
//   node exam/run.js --route teacher              # Sonnet 5.5 on the train sample, recording ON (trains the adapter)
//   node exam/run.js --route sonnet|haiku|luna    # provider-only exam on the 3 test splits, recording OFF (metadata)
//   node exam/run.js --route routed               # the Sonnet exam again, unforced: Mubit picks provider or adapter
//   node exam/run.js --probe                      # 1-2 calls: does Mubit route to the adapter right now?
//
// Options: --split test_task (one split), --limit N, --record full|metadata (routed only),
// --concurrency 4, --no-cache (routed: ask Mubit again after a new adapter version).
// Responses are cached by input hash in exam/.cache/, so a rerun costs nothing.
// Per-call logs go to exam/data/calls-<route>-<split>.jsonl (gitignored: holds test answers).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { anthropicBody, parseJson } from '../server/llm.js';
import { EXAM_SYSTEM_PROMPT, convertStep, scoreAnswer } from './convert.js';
import { costUsd } from './prices.js';

const HERE = import.meta.dirname;
const DATA = path.join(HERE, 'data');
const CACHE = path.join(HERE, '.cache');
// One line per paid call; appends are safe when several routes run at once.
const SPEND_FILE = path.join(CACHE, 'spend.jsonl');
const BASE = 'https://api.mubit.ai';
export const BUDGET_USD = 8;
export const TEST_SPLITS = ['test_task', 'test_website', 'test_domain'];

export const ROUTES = {
  teacher: { provider: 'anthropic', model: 'claude-sonnet-5-5', record: 'full', splits: ['train'] },
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-5-5', record: 'metadata', splits: TEST_SPLITS },
  haiku: { provider: 'anthropic', model: 'claude-haiku-4-5', record: 'metadata', splits: TEST_SPLITS },
  luna: { provider: 'openai', model: 'gpt-6-luna', record: 'metadata', splits: TEST_SPLITS },
  routed: { provider: 'anthropic', model: 'claude-sonnet-5-5', record: 'metadata', splits: TEST_SPLITS },
};

let cachedKey;
function apiKey() {
  if (cachedKey) return cachedKey;
  cachedKey = process.env.MUBIT_API_KEY
    || execFileSync('security', ['find-generic-password', '-s', 'mubit-api-key', '-w'], { encoding: 'utf8' }).trim();
  if (!cachedKey) throw new Error('No Mubit key: set MUBIT_API_KEY or add mubit-api-key to the keychain');
  return cachedKey;
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function loadSteps(split) {
  const pages = new Map(readJsonl(path.join(DATA, `pages-${split}.jsonl`)).map(p => [p.action_uid, p]));
  return readJsonl(path.join(DATA, `steps-${split}.jsonl`))
    .filter(s => pages.has(s.action_uid))
    .map(s => ({ step: s, ...convertStep(s, pages.get(s.action_uid)) }))
    .filter(c => c.expected.element_ids.length);
}

function request(route, userMessage, sessionId) {
  const { provider, model } = route;
  if (provider === 'openai') {
    // No `metadata` (OpenAI refuses it without `store`) and no `store`: Mubit takes the
    // session from the first message.
    return {
      url: `${BASE}/openai/v1/chat/completions`,
      headers: { authorization: `Bearer ${apiKey()}` },
      body: {
        model,
        max_completion_tokens: 600,
        reasoning_effort: 'none',
        messages: [{ role: 'system', content: EXAM_SYSTEM_PROMPT }, { role: 'user', content: userMessage }],
      },
    };
  }
  return {
    url: `${BASE}/anthropic/v1/messages`,
    headers: { 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01' },
    body: anthropicBody(model, EXAM_SYSTEM_PROMPT, userMessage, sessionId),
  };
}

export function readSpend() {
  const lines = fs.existsSync(SPEND_FILE) ? fs.readFileSync(SPEND_FILE, 'utf8').split('\n').filter(Boolean) : [];
  const entries = lines.map(line => JSON.parse(line));
  return { usd: entries.reduce((sum, e) => sum + e.usd, 0), calls: entries.reduce((sum, e) => sum + (e.calls ?? 1), 0) };
}

function addSpend(usd, model) {
  fs.appendFileSync(SPEND_FILE, JSON.stringify({ ts: Date.now(), model, usd }) + '\n');
}

class BudgetError extends Error {}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One gateway call with backoff on 429 (starter_credit_busy) and 5xx. Never logs the key.
async function send(route, userMessage, sessionId, record) {
  const req = request(route, userMessage, sessionId);
  for (let attempt = 0; ; attempt++) {
    if (readSpend().usd >= BUDGET_USD) throw new BudgetError(`budget cap $${BUDGET_USD} reached`);
    const started = Date.now();
    let res, text;
    try {
      res = await fetch(req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-middleware-record': record, ...req.headers },
        body: JSON.stringify(req.body),
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
    const reply = route.provider === 'openai'
      ? { text: data.choices?.[0]?.message?.content || '', inTokens: data.usage?.prompt_tokens || 0, outTokens: data.usage?.completion_tokens || 0 }
      : { text: (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), inTokens: data.usage?.input_tokens || 0, outTokens: data.usage?.output_tokens || 0 };
    // Budget counts every paid call at the provider's list price, even if the adapter served it.
    addSpend(costUsd(route.model, reply.inTokens, reply.outTokens), route.model);
    return { ok: true, status: res.status, ms, headers, ...reply };
  }
}

export function servedBy(headers = {}) {
  const by = String(headers['x-middleware-served-by'] || '');
  const all = Object.values(headers).join(' ');
  return { adapter: /vllm/i.test(by), version: all.match(/version=(\d+)/)?.[1] ?? null };
}

async function pool(items, concurrency, fn) {
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export async function runRoute(name, { split, limit, record, concurrency = 4, noCache = false, log = console.error } = {}) {
  const route = { ...ROUTES[name], ...(record ? { record } : {}) };
  fs.mkdirSync(CACHE, { recursive: true });
  const splits = split ? [split] : route.splits;
  const summary = {};
  for (const s of splits) {
    let calls = loadSteps(s);
    if (limit) calls = calls.slice(0, limit);
    const out = path.join(DATA, `calls-${name}-${s}.jsonl`);
    const rows = [];
    let stopped = null;
    await pool(calls, concurrency, async c => {
      if (stopped) return;
      const sessionId = c.step.annotation_id;
      const key = crypto.createHash('sha256')
        .update(JSON.stringify({ name, model: route.model, record: route.record, system: EXAM_SYSTEM_PROMPT, user: c.userMessage }))
        .digest('hex');
      const cacheFile = path.join(CACHE, `${key}.json`);
      let result;
      if (!noCache && fs.existsSync(cacheFile)) result = { ...JSON.parse(fs.readFileSync(cacheFile, 'utf8')), cached: true };
      else {
        try { result = await send(route, c.userMessage, sessionId, route.record); }
        catch (err) {
          if (err instanceof BudgetError) { stopped = err.message; return; }
          result = { ok: false, error: err.message };
        }
        if (result.ok) fs.writeFileSync(cacheFile, JSON.stringify(result));
      }
      const answer = result.ok ? parseJson(result.text) : null;
      const score = scoreAnswer(answer, c.expected);
      rows.push({
        action_uid: c.step.action_uid, annotation_id: c.step.annotation_id, website: c.step.website, domain: c.step.domain,
        route: name, model: route.model, record: route.record, ok: !!result.ok, status: result.status, error: result.error,
        ms: result.ms, inTokens: result.inTokens, outTokens: result.outTokens, cost: result.ok ? costUsd(route.model, result.inTokens, result.outTokens) : 0,
        headers: result.headers, ...servedBy(result.headers), cached: !!result.cached,
        answer, expected: c.expected, ...score,
      });
      if (rows.length % 25 === 0) log(`${name} ${s}: ${rows.length}/${calls.length}, spend $${readSpend().usd.toFixed(2)}`);
    });
    rows.sort((a, b) => a.action_uid.localeCompare(b.action_uid));
    fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const ok = rows.filter(r => r.ok);
    summary[s] = {
      calls: rows.length, ok: ok.length, stepSR: ok.length ? ok.filter(r => r.step).length / rows.length : 0,
      adapter: rows.filter(r => r.adapter).length, versions: [...new Set(rows.map(r => r.version).filter(Boolean))],
      stopped,
    };
    log(`${name} ${s}: ${JSON.stringify(summary[s])}`);
    if (stopped) break;
  }
  return { summary, spend: readSpend() };
}

// One call (two at most) on a train step: does Mubit hand it to the adapter? First with
// recording off (metadata), as the exam sends; if the provider answered, again with
// recording on, to see whether routing needs a recorded call.
export async function probe({ log = console.log } = {}) {
  const route = ROUTES.routed;
  const [c] = loadSteps('train').slice(-1);
  const results = [];
  for (const record of ['metadata', 'full']) {
    const r = await send(route, c.userMessage, c.step.annotation_id, record);
    const by = servedBy(r.headers);
    results.push({ record, ok: r.ok, status: r.status, ms: r.ms, adapter: by.adapter, version: by.version, headers: r.headers, error: r.error });
    log(`probe record=${record}: ${r.ok ? 'ok' : `HTTP ${r.status}`} ${r.ms} ms, served by ${by.adapter ? `ADAPTER (version=${by.version})` : 'provider'}; x-middleware headers: ${JSON.stringify(r.headers)}`);
    if (by.adapter || !r.ok) break;
  }
  fs.writeFileSync(path.join(DATA, `probe-${Date.now()}.json`), JSON.stringify(results, null, 2));
  return results;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      route: { type: 'string' }, split: { type: 'string' }, limit: { type: 'string' },
      record: { type: 'string' }, concurrency: { type: 'string' }, probe: { type: 'boolean' }, 'no-cache': { type: 'boolean' },
    },
  });
  if (values.probe) await probe();
  else if (ROUTES[values.route]) {
    if (values.record && values.route !== 'routed') throw new Error('--record only applies to --route routed');
    const result = await runRoute(values.route, {
      split: values.split, limit: values.limit ? Number(values.limit) : undefined,
      record: values.record, noCache: !!values['no-cache'], concurrency: values.concurrency ? Number(values.concurrency) : 4,
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`Usage: node exam/run.js --route ${Object.keys(ROUTES).join('|')} [--split S] [--limit N] [--record full|metadata]\n       node exam/run.js --probe`);
    process.exit(2);
  }
}
