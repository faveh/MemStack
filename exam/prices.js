// List prices in USD per million tokens [in, out]. Anthropic rows copy MODEL_PRICES in
// server/ledger.js (not exported); gpt-6-luna from third-party pages quoting OpenAI.
export const PRICES = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
  'gpt-6-luna': [0.10, 0.50],
};

export function costUsd(model, inTokens = 0, outTokens = 0) {
  const [pin, pout] = PRICES[model] || [2, 10];
  return (inTokens * pin + outTokens * pout) / 1e6;
}
