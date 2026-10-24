// Aggregates exam/data/calls-*.jsonl into exam/results.json and the table in exam/README.md.
//   node exam/report.js
// Only aggregates leave exam/data/: no test-split step or answer is written out.

import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, readSpend, ROUTES } from './run.js';

const HERE = import.meta.dirname;
const DATA = path.join(HERE, 'data');
// Adapter calls have no published price; server/ledger.js estimates them at 5% of the
// provider call (ADAPTER_COST_RATIO). Used only for the routed route's estimate column.
export const ADAPTER_COST_RATIO = 0.05;

function quantile(nums, q) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const mean = nums => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
const round = (x, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function summarize(rows) {
  const ok = rows.filter(r => r.ok);
  const adapterRows = ok.filter(r => r.adapter);
  const providerCost = ok.filter(r => !r.adapter).reduce((a, r) => a + r.cost, 0);
  const adapterCost = adapterRows.reduce((a, r) => a + r.cost * ADAPTER_COST_RATIO, 0);
  return {
    steps: rows.length,
    answered: ok.length,
    tasks: new Set(rows.map(r => r.annotation_id)).size,
    sites: new Set(rows.map(r => r.website)).size,
    stepSR: round(100 * rows.filter(r => r.step).length / rows.length),
    eleAcc: round(100 * rows.filter(r => r.element).length / rows.length),
    opF1: round(100 * mean(rows.map(r => r.opF1 || 0))),
    medianMs: quantile(ok.map(r => r.ms), 0.5),
    p90Ms: quantile(ok.map(r => r.ms), 0.9),
    usdPer1k: round(1000 * (providerCost + adapterCost) / Math.max(1, ok.length), 3),
    adapterShare: round(100 * adapterRows.length / Math.max(1, ok.length)),
    adapterVersions: [...new Set(adapterRows.map(r => r.version).filter(Boolean))],
    inTokensMedian: quantile(ok.map(r => r.inTokens), 0.5),
  };
}

export function buildResults() {
  const results = {};
  for (const [route, def] of Object.entries(ROUTES)) {
    for (const split of def.splits) {
      const rows = readJsonl(path.join(DATA, `calls-${route}-${split}.jsonl`));
      if (!rows.length) continue;
      results[route] ??= { model: def.model, record: rows[0].record, splits: {} };
      results[route].splits[split] = summarize(rows);
    }
    if (results[route] && def.splits.length > 1) {
      const all = def.splits.flatMap(s => readJsonl(path.join(DATA, `calls-${route}-${s}.jsonl`)));
      results[route].splits.all = summarize(all);
    }
  }
  return results;
}

const LABELS = { teacher: 'Sonnet 5.5, teacher (train, recorded)', sonnet: 'Sonnet 5.5, provider only', haiku: 'Haiku 4.5, provider only', luna: 'gpt-6-luna, provider only', routed: 'Sonnet 5.5, Mubit-routed' };

export function table(results) {
  const lines = [
    '| Route | Split | Steps | Step SR | Ele.Acc | Op-F1 | Median ms | p90 ms | $ / 1,000 steps | Adapter share |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [route, r] of Object.entries(results)) {
    for (const [split, s] of Object.entries(r.splits)) {
      const share = route === 'routed' ? `${s.adapterShare}%${s.adapterVersions.length ? ` (v${s.adapterVersions.join(', v')})` : ''}` : '–';
      lines.push(`| ${LABELS[route]} | ${split} | ${s.steps} | ${s.stepSR}% | ${s.eleAcc}% | ${s.opF1}% | ${s.medianMs} | ${s.p90Ms} | $${s.usdPer1k.toFixed(2)} | ${share} |`);
    }
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const results = buildResults();
  const spend = readSpend();
  fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), spendUsd: round(spend.usd, 2), paidCalls: spend.calls, routes: results }, null, 2) + '\n');
  const md = table(results);
  const readme = path.join(HERE, 'README.md');
  if (fs.existsSync(readme)) {
    const text = fs.readFileSync(readme, 'utf8');
    const next = text.replace(/<!-- results:start -->[\s\S]*<!-- results:end -->/, `<!-- results:start -->\n${md}\n<!-- results:end -->`);
    fs.writeFileSync(readme, next);
  }
  console.log(md);
}
