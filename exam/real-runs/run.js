// Show Me on real public websites, through the real extension and the real server, so the
// calls land in the same Mubit tasks as the live agent (same system prompts, message
// builders, model and request body). Recording stays on: no x-middleware-record header.
//
//   node exam/real-runs/run.js                 # every goal not run yet
//   node exam/real-runs/run.js --limit 10      # the next 10
//   node exam/real-runs/run.js --only wiki-lagos,gh-node
//   node exam/real-runs/run.js --phase after-fix   # label the runs (the README has one row per label)
//   node exam/real-runs/run.js --report        # rewrite the README table from the results
//   SHOWME_CHROMIUM=/path/to/chromium node exam/real-runs/run.js   # another Chromium build
//
// How: headless Chromium (new headless) loads extension/ unpacked; an extension page imports
// extension/agent-core.js and calls its runAgent on a real tab, exactly as the side panel
// does. Show Me's own server (server/index.js, unchanged) runs on a free port. Its Mubit
// base URL points at a small local pass-through that forwards each call unchanged to
// api.mubit.ai and notes the reply's x-middleware-served-by header, tokens and cost.
// The key comes from MUBIT_API_KEY or the keychain item mubit-api-key and is never logged.
//
// Output goes to $REALRUNS_DIR (default exam/real-runs/data/, gitignored): results.jsonl
// (one line per run, no page content), calls.jsonl (one line per Mubit call) and the
// server's own data. Nothing from third-party pages is committed.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { SYSTEM_PROMPTS } from '../../server/prompts.js';
import { costUsd } from '../prices.js';
import { GOALS } from './goals.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = process.env.REALRUNS_DIR || path.join(import.meta.dirname, 'data');
const RESULTS = path.join(OUT, 'results.jsonl');
const CALLS = path.join(OUT, 'calls.jsonl');
const README = path.join(import.meta.dirname, 'README.md');
const UPSTREAM = 'https://api.mubit.ai';
const MODEL = 'claude-haiku-4-5';
export const BUDGET_USD = 1.5;
// The pass-through refuses calls past this, so a run in flight can't cross the cap.
const STOP_AT_USD = 1.45;
export const MAX_STEPS = 12;
const RUN_TIMEOUT_MS = 240_000;

// Hard rules: never log in, sign up, buy, book, pay, post, send, or fill in personal data.
// A step that would do one of these stops the run before it happens. A cookie banner is fine.
export const RULES = {
  label: /\b(log ?in|log ?on|sign ?(in|up|on)|register|create (an )?account|join now|subscribe|newsletter|add to (cart|basket|bag|trolley)|checkout|check out|buy|purchase|place order|pay|donate|book (now|tickets?|online|a)|reserve|post (a|your|comment)|publish|leave a comment|reply|send|submit|contact us|enquire|apply now)\b|^(star|fork|watch|sponsor|follow)\b/i,
  field: /\b(e-?mail|password|passcode|phone|mobile|address|postcode|zip|card|name|surname|date of birth|message)\b/i,
  url: /\/(login|signin|sign-in|signup|sign-up|register|join|checkout|cart|basket|account|subscribe|donate)\b/i,
  cookie: /cookies?|consent|reject( all)?|necessary|essential|accept( all)?|agree|allow( all)?|got it|close|dismiss/gi,
};

// Pure (no outside names), because the runner also sends its source into the extension page.
export function unsafeWith(re, next) {
  const label = String(next.label || '');
  if (next.action === 'open_url') return re.url.test(next.value) ? `opens ${next.value}` : null;
  if (next.action === 'type') return re.field.test(label) && !/search|forecast|city|town|location|station|find/i.test(label) ? `types into “${label}”` : null;
  if (!['click', 'press', 'select'].includes(next.action)) return null;
  // A cookie banner button is fine, unless it also signs you up for something.
  const rest = label.replace(re.cookie, '');
  if (rest !== label && !re.label.test(rest)) return null;
  return re.label.test(label) ? `clicks “${label}”` : null;
}
export const unsafeStep = next => unsafeWith(RULES, next);

const BLOCKED_PAGE = /captcha|are you a robot|not a robot|verify you are human|unusual traffic|access denied|request blocked|just a moment|attention required|enable javascript and cookies/i;

const readJsonl = file => fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const append = (file, record) => fs.appendFileSync(file, JSON.stringify(record) + '\n');
export const spentUsd = () => readJsonl(CALLS).reduce((sum, c) => sum + (c.usd || 0), 0);

const TASK_OF = new Map(Object.entries(SYSTEM_PROMPTS).map(([task, system]) => [system, task]));

export function servedBy(headers) {
  const by = String(headers.get('x-middleware-served-by') || '');
  const all = [...headers].filter(([k]) => k.startsWith('x-middleware')).map(([, v]) => v).join(' ');
  return { servedBy: by || null, adapter: /vllm/i.test(by), version: all.match(/version=(\d+)/)?.[1] ?? null };
}

// Forwards every request to Mubit unchanged; notes who served it and what it cost.
function startPassThrough() {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    let json = {};
    try { json = JSON.parse(body.toString('utf8')); } catch { /* forwarded as is */ }
    if (spentUsd() >= STOP_AT_USD) {
      res.writeHead(402, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `real-runs budget reached ($${spentUsd().toFixed(3)} of $${BUDGET_USD})` } }));
    }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length', 'accept-encoding'].includes(k)));
    const started = Date.now();
    let up;
    try {
      up = await fetch(UPSTREAM + req.url, { method: req.method, headers, body: req.method === 'GET' ? undefined : body, signal: AbortSignal.timeout(90_000) });
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `pass-through could not reach Mubit: ${err.cause?.code || err.message}` } }));
    }
    const text = await up.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    const inTokens = data?.usage?.input_tokens || 0;
    const outTokens = data?.usage?.output_tokens || 0;
    append(CALLS, {
      ts: new Date().toISOString(), status: up.status, ms: Date.now() - started, model: json.model,
      task: TASK_OF.get(json.system) || 'unknown', sessionId: json.metadata?.user_id || null,
      requestId: up.headers.get('x-middleware-request-id'), ...servedBy(up.headers),
      inTokens, outTokens, usd: costUsd(json.model || MODEL, inTokens, outTokens),
    });
    const out = {};
    for (const [k, v] of up.headers) if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) out[k] = v;
    res.writeHead(up.status, out);
    res.end(text);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function mubitKey() {
  return process.env.MUBIT_API_KEY || execFileSync('security', ['find-generic-password', '-s', 'mubit-api-key', '-w'], { encoding: 'utf8' }).trim();
}

async function startShowMeServer(proxyPort) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env, PORT: String(port), MUBIT_API_KEY: mubitKey(), MUBIT_PROVIDER: 'anthropic', MUBIT_MODEL: MODEL,
      MUBIT_BASE_URL: `http://127.0.0.1:${proxyPort}`, SHOWME_DATA_DIR: path.join(OUT, 'server'), SAPLING_LOG: path.join(OUT, 'verifier.log'),
    },
  });
  child.stderr.on('data', d => fs.appendFileSync(path.join(OUT, 'server.log'), d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const health = await (await fetch(`${base}/api/health`)).json();
      if (health.provider !== 'anthropic' || health.model !== MODEL) throw new Error(`server is on ${health.provider}/${health.model}`);
      return { child, base };
    } catch (err) {
      if (/server is on/.test(err.message)) { child.kill(); throw err; }
      await new Promise(r => setTimeout(r, 200));
    }
  }
  child.kill();
  throw new Error('Show Me server did not start');
}

// Runs inside an extension page: the extension's own agent loop on a real tab.
async function agentInPage({ goal, tabId, maxSteps, timeoutMs, rules }, unsafeWith) {
  const { runAgent, createApi, getServer } = await import('./agent-core.js');
  const re = Object.fromEntries(Object.entries(rules).map(([k, [src, flags]]) => [k, new RegExp(src, flags)]));
  const unsafe = next => unsafeWith(re, next);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let decisions = 0, stoppedBy = null, timedOut = false;
  ctrl.signal.addEventListener('abort', () => { if (!stoppedBy) timedOut = true; });
  const r = await runAgent({
    goal, tabId, api: createApi(getServer), signal: ctrl.signal,
    isStopped: () => !!stoppedBy || timedOut || decisions >= maxSteps,
    ui: {
      step: next => {
        decisions++;
        const why = unsafe(next);
        if (why) { stoppedBy = why; throw Object.assign(new Error('Stopped.'), { name: 'AbortError' }); }
      },
    },
  });
  clearTimeout(timer);
  const capped = r.outcome === 'stopped' && !stoppedBy && !timedOut;
  return {
    outcome: stoppedBy ? 'stopped' : timedOut ? 'timeout' : capped ? 'capped' : r.outcome,
    stoppedBy, failure: r.failure, steps: r.history.length, decisions: r.decisions, invalid: r.invalid,
    usedLesson: r.usedLesson, actions: r.history.map(h => h.action),
  };
}

async function main() {
  const { values } = parseArgs({ options: { limit: { type: 'string' }, only: { type: 'string' }, report: { type: 'boolean' }, phase: { type: 'string', default: 'before-fix' } } });
  fs.mkdirSync(OUT, { recursive: true });
  if (values.report) return writeReport();
  const done = new Set(readJsonl(RESULTS).filter(r => r.phase === values.phase).map(r => r.id));
  let todo = GOALS.filter(g => !done.has(g.id));
  if (values.only) todo = GOALS.filter(g => values.only.split(',').includes(g.id));
  if (values.limit) todo = todo.slice(0, Number(values.limit));
  if (spentUsd() >= STOP_AT_USD) throw new Error(`Budget reached: $${spentUsd().toFixed(3)} of $${BUDGET_USD}`);

  const { chromium } = await import('playwright');
  const proxy = await startPassThrough();
  const { child, base } = await startShowMeServer(proxy.address().port);
  const ext = path.join(ROOT, 'extension');
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'showme-real-')), {
    channel: 'chromium', headless: true, executablePath: process.env.SHOWME_CHROMIUM || undefined,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
    const extId = new URL(worker.url()).host;
    await worker.evaluate(server => chrome.storage.local.set({ server, autorun: false }), base);
    const host = await context.newPage();
    await host.goto(`chrome-extension://${extId}/newtab.html`);
    const rules = Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, [v.source, v.flags]]));

    for (const g of todo) {
      if (spentUsd() >= STOP_AT_USD) { console.log(`budget reached: $${spentUsd().toFixed(3)}`); break; }
      const started = new Date().toISOString();
      const callsBefore = readJsonl(CALLS).length;
      const page = await context.newPage();
      let result;
      try {
        await page.goto(g.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
        const text = `${await page.title()} ${(await page.evaluate(() => document.body?.innerText || '')).slice(0, 3000)}`;
        if (BLOCKED_PAGE.test(text)) {
          result = { outcome: 'skipped', failure: 'site blocks bots or shows a CAPTCHA', steps: 0, decisions: 0 };
        } else {
          const tabId = await worker.evaluate(async u => (await chrome.tabs.query({})).find(t => t.url === u)?.id, page.url());
          if (!tabId) throw new Error('could not find the tab');
          const args = { goal: g.goal, tabId, maxSteps: MAX_STEPS, timeoutMs: RUN_TIMEOUT_MS, rules };
          result = await host.evaluate(`(${agentInPage})(${JSON.stringify(args)}, ${unsafeWith})`);
        }
      } catch (err) {
        result = { outcome: 'error', failure: err.message.slice(0, 300), steps: 0, decisions: 0 };
      }
      const calls = readJsonl(CALLS).slice(callsBefore);
      const record = {
        id: g.id, phase: values.phase, site: new URL(g.url).host, goal: g.goal, started, ...result,
        calls: calls.length, adapterCalls: calls.filter(c => c.adapter).length, usd: calls.reduce((s, c) => s + c.usd, 0),
        tasks: calls.reduce((m, c) => ({ ...m, [c.task]: (m[c.task] || 0) + 1 }), {}),
      };
      append(RESULTS, record);
      console.log(`${g.id}: ${record.outcome}${record.stoppedBy ? ` (${record.stoppedBy})` : ''}, ${record.steps} steps, ${record.calls} calls, $${record.usd.toFixed(4)} · total $${spentUsd().toFixed(3)}`);
      await page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
    child.kill();
    proxy.close();
  }
  writeReport();
}

export function summarize(results, calls) {
  const answered = calls.filter(c => c.status === 200);
  const count = o => results.filter(r => r.outcome === o).length;
  const ran = results.filter(r => r.outcome !== 'skipped');
  return {
    runs: ran.length, finished: count('done'), failed: count('failed') + count('asked'), stopped: count('stopped'),
    capped: count('capped'), errors: count('error') + count('timeout'), skipped: count('skipped'),
    steps: ran.reduce((s, r) => s + (r.steps || 0), 0), calls: calls.length,
    byTask: calls.reduce((m, c) => ({ ...m, [c.task]: (m[c.task] || 0) + 1 }), {}),
    usd: calls.reduce((s, c) => s + (c.usd || 0), 0),
    adapterShare: answered.length ? answered.filter(c => c.adapter).length / answered.length : 0,
    versions: [...new Set(answered.filter(c => c.adapter).map(c => c.version).filter(Boolean))],
  };
}

// The calls made during a run: those logged between its start and the next run's start.
function callsOf(results, calls) {
  const starts = readJsonl(RESULTS).map(r => r.started).sort();
  return calls.filter(c => results.some(r => c.ts >= r.started && !starts.some(s => s > r.started && s <= c.ts)));
}

function writeReport() {
  const results = readJsonl(RESULTS);
  const calls = readJsonl(CALLS);
  const pct = n => `${Math.round(n * 1000) / 10}%`;
  const phases = [...new Set(results.map(r => r.phase || 'before-fix'))];
  const rows = [...phases.map(p => [p, results.filter(r => (r.phase || 'before-fix') === p)]), ['all', results]].map(([name, rs]) => {
    const s = summarize(rs, name === 'all' ? calls : callsOf(rs, calls));
    return `| ${name} | ${s.runs} | ${s.finished} | ${s.failed} | ${s.stopped} | ${s.capped} | ${s.errors} | ${s.skipped} | ${s.steps} | ${s.calls} | $${s.usd.toFixed(2)} | ${pct(s.adapterShare)}${s.versions.length ? ` (version ${s.versions.join(', ')})` : ''} |`;
  });
  const byTask = summarize(results, calls).byTask;
  const table = [
    '| Phase | Runs done | Finished | Failed | Stopped (safety) | Hit 12-step cap | Errors | Sites skipped | Steps | Mubit calls | Est. cost | Adapter share |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `Calls by task: ${Object.entries(byTask).map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}.`,
  ].join('\n');
  const readme = fs.readFileSync(README, 'utf8');
  fs.writeFileSync(README, readme.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, `<!-- results:start -->\n${table}\n<!-- results:end -->`));
  console.log(table);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}
