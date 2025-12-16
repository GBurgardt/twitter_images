export function normalizeClaudeModelId(model) {
  const raw = (model || '').toString().trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();

  if (lower === 'claude-opus-4.5' || lower === 'claude opus 4.5' || lower === 'opus 4.5' || lower === 'opus4.5') {
    return 'claude-opus-4-5';
  }

  return raw.replace(/claude-opus-4\.5/gi, 'claude-opus-4-5').replace(/claude_opus_4\.5/gi, 'claude-opus-4-5');
}

export function resolveAgentModel({ provider, config }) {
  const providerKey = (provider || '').toString().toLowerCase();

  const defaultGeminiModel = 'gemini-3-pro-preview';
  const defaultClaudeModel = 'claude-opus-4-5';
  const defaultOpenAIModel = 'gpt-5.2';

  const configModelRaw = (config?.agentModel || '').toString().trim();
  const configModelLower = configModelRaw.toLowerCase();

  const looksLikeOpenAIModel =
    configModelLower.startsWith('gpt-') || (configModelLower.startsWith('o') && !configModelLower.startsWith('opus'));

  const model =
    providerKey === 'claude'
      ? (configModelLower.includes('claude') || configModelLower.includes('opus') ? normalizeClaudeModelId(configModelRaw) : defaultClaudeModel)
      : providerKey === 'openai'
        ? (looksLikeOpenAIModel ? configModelRaw : defaultOpenAIModel)
        : (configModelLower.includes('gemini') ? configModelRaw : defaultGeminiModel);

  return { provider: providerKey, model };
}

