export function normalizeProviderName(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (!v) return 'openai';
  if (v === 'opus') return 'claude';
  if (v === 'claude') return 'claude';
  if (v === 'anthropic') return 'claude';
  if (v === 'openai') return 'openai';
  if (v.startsWith('gpt-') || (v.startsWith('o') && !v.startsWith('opus'))) return 'openai';
  return 'gemini';
}

export function resolveModelSelection(raw) {
  const input = (raw || '').toString().trim();
  if (!input) return null;

  const normalized = input.toLowerCase();

  const presets = {
    gemini: { provider: 'gemini', model: 'gemini-3-pro-preview' },
    g3: { provider: 'gemini', model: 'gemini-3-pro-preview' },
    'gemini-3': { provider: 'gemini', model: 'gemini-3-pro-preview' },
    'gemini-3-pro': { provider: 'gemini', model: 'gemini-3-pro-preview' },
    'gemini-3-pro-preview': { provider: 'gemini', model: 'gemini-3-pro-preview' },

    opus: { provider: 'claude', model: 'claude-opus-4.5' },
    claude: { provider: 'claude', model: 'claude-opus-4.5' },
    'claude-opus': { provider: 'claude', model: 'claude-opus-4.5' },
    'claude-opus-4.5': { provider: 'claude', model: 'claude-opus-4.5' },

    openai: { provider: 'openai', model: 'gpt-5.2' },
    gpt: { provider: 'openai', model: 'gpt-5.2' },
    'gpt-5.2': { provider: 'openai', model: 'gpt-5.2' },
    'gpt-5.2-pro': { provider: 'openai', model: 'gpt-5.2-pro' },
    'gpt-5.2-chat-latest': { provider: 'openai', model: 'gpt-5.2-chat-latest' }
  };

  const preset = presets[normalized];
  if (preset) return preset;

  if (normalized.startsWith('gpt-') || (normalized.startsWith('o') && !normalized.startsWith('opus'))) {
    return { provider: 'openai', model: input };
  }
  if (normalized.includes('claude') || normalized.includes('opus')) {
    return { provider: 'claude', model: input };
  }
  if (normalized.includes('gemini')) {
    return { provider: 'gemini', model: input };
  }

  const provider = normalizeProviderName(normalized);
  return {
    provider,
    model: provider === 'openai' ? 'gpt-5.2' : provider === 'claude' ? 'claude-opus-4.5' : 'gemini-3-pro-preview'
  };
}

