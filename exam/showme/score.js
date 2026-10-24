// Scores one next-action answer against hand-written expected actions. A question can
// accept several actions (filling the party size or the day first are both right); the
// answer is correct if it matches any of them.
//
// Expected action: { action, element_ids?: [...], value?: 'exact text', value_match?: 'regex' }
// - action must be equal.
// - element_ids, if given: the answer's element_id must be one of them.
// - value, if given: equal after trim, case-insensitive. value_match: a case-insensitive regex.

const norm = v => String(v ?? '').trim().toLowerCase();

export function matches(answer, expected) {
  if (!answer || norm(answer.action) !== norm(expected.action)) return false;
  if (expected.element_ids && !expected.element_ids.includes(String(answer.element_id ?? '').trim())) return false;
  if (expected.value !== undefined && norm(answer.value) !== norm(expected.value)) return false;
  if (expected.value_match !== undefined && !new RegExp(expected.value_match, 'i').test(String(answer.value ?? ''))) return false;
  return true;
}

export function scoreAnswer(answer, expectedList) {
  const actionOk = !!answer && expectedList.some(e => norm(e.action) === norm(answer.action));
  return { correct: expectedList.some(e => matches(answer, e)), actionOk };
}

export function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Mubit adds x-middleware-served-by; it contains "vllm" when the adapter answered.
export function servedBy(headers = {}) {
  const by = String(headers['x-middleware-served-by'] || '');
  const all = Object.values(headers).join(' ');
  return { adapter: /vllm/i.test(by), version: all.match(/version=(\d+)/)?.[1] ?? null };
}

// rows: { ok, correct, ms, cost, adapter }. Adapter-served calls are priced at
// adapterRatio of the provider call (the estimate server/ledger.js uses).
export function summarize(rows, { adapterRatio = 0.05 } = {}) {
  const ok = rows.filter(r => r.ok);
  const cost = ok.reduce((sum, r) => sum + (r.adapter ? r.cost * adapterRatio : r.cost), 0);
  return {
    questions: rows.length,
    answered: ok.length,
    correct: rows.filter(r => r.correct).length,
    accuracy: rows.length ? rows.filter(r => r.correct).length / rows.length : 0,
    medianMs: median(ok.map(r => r.ms)),
    usdPer1000: ok.length ? (cost / ok.length) * 1000 : 0,
    adapterShare: ok.length ? ok.filter(r => r.adapter).length / ok.length : 0,
    versions: [...new Set(ok.map(r => r.version).filter(Boolean))],
  };
}
