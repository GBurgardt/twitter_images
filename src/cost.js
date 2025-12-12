/**
 * Cost estimation helpers (OpenAI Responses usage → USD).
 *
 * Notes:
 * - The OpenAI SDK returns token counts in `response.usage` (Responses API).
 * - Pricing is per 1M tokens (input / cached input / output).
 * - Some models may not publish cached-input pricing; we fall back to input rate.
 */

const PER_MILLION = 1_000_000;

// USD per 1M tokens (input, cached input, output)
// Source: OpenAI model/pricing docs via Brave search snippets (platform.openai.com/openai.com pages are CF-blocked in curl here).
const OPENAI_PRICING_PER_1M = {
  'gpt-5.2': { input: 1.75, cached_input: 0.175, output: 14.0 },
  'gpt-5.2-pro': { input: 21.0, cached_input: null, output: 168.0 }
};

function normalizeModelId(model = '') {
  const m = (model || '').toString().trim();
  if (!m) return '';
  // Handle snapshots/aliases like "gpt-5.2-2025-12-11"
  if (m.startsWith('gpt-5.2-pro')) return 'gpt-5.2-pro';
  if (m.startsWith('gpt-5.2-chat-latest')) return 'gpt-5.2-chat-latest';
  if (m === 'gpt-5.2') return 'gpt-5.2';
  if (/^gpt-5\.2-\d/.test(m)) return 'gpt-5.2';
  return m;
}

export function getOpenAIPricingPer1M(model) {
  const key = normalizeModelId(model);
  return OPENAI_PRICING_PER_1M[key] || null;
}

export function estimateOpenAICostUSD({ model, usage }) {
  if (!usage) return null;
  const pricing = getOpenAIPricingPer1M(model);
  if (!pricing) return null;

  const inputTokens = Number(usage.input_tokens || 0);
  const cachedTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);

  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  const cachedRate = pricing.cached_input == null ? pricing.input : pricing.cached_input;

  const inputCost = (uncachedInput / PER_MILLION) * pricing.input;
  const cachedCost = (cachedTokens / PER_MILLION) * cachedRate;
  const outputCost = (outputTokens / PER_MILLION) * pricing.output;

  const total = inputCost + cachedCost + outputCost;

  return {
    totalUSD: total,
    breakdownUSD: { input: inputCost, cached_input: cachedCost, output: outputCost },
    pricingPer1M: { ...pricing, cached_input: cachedRate },
    tokens: {
      input: inputTokens,
      cached_input: cachedTokens,
      output: outputTokens,
      reasoning: Number(usage.output_tokens_details?.reasoning_tokens || 0),
      total: Number(usage.total_tokens || (inputTokens + outputTokens))
    }
  };
}

export function formatUSD(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(n);
}
