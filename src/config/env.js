const ENV_MAPPINGS = {
  mistralApiKey: ['MISTRAL_API_KEY'],
  geminiApiKey: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  anthropicApiKey: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  openaiApiKey: ['OPENAI_API_KEY'],
  redditClientId: ['REDDIT_CLIENT_ID'],
  redditClientSecret: ['REDDIT_CLIENT_SECRET'],
  redditUserAgent: ['REDDIT_USER_AGENT'],
  mongodbUrl: ['MONGODB_URL', 'MONGO_URL', 'MONGO_URI'],
  agentProvider: ['TWX_AGENT_PROVIDER'],
  mode: ['TWX_MODE'],
  verbose: ['TWX_DEBUG'],
  keepDownloads: ['TWX_KEEP_DOWNLOADS'],
  thinkingLevel: ['GEMINI_THINKING_LEVEL'],
  mediaResolution: ['GEMINI_MEDIA_RESOLUTION'],
  visionModel: ['GEMINI_VISION_MODEL'],
  agentModel: ['TWX_AGENT_MODEL', 'OPENAI_AGENT_MODEL', 'GEMINI_AGENT_MODEL'],
  openaiReasoningEffort: ['TWX_OPENAI_REASONING_EFFORT', 'OPENAI_REASONING_EFFORT'],
  agentMaxOutputTokens: ['AGENT_MAX_OUTPUT_TOKENS', 'OPENAI_MAX_OUTPUT_TOKENS', 'GEMINI_MAX_OUTPUT_TOKENS', 'CLAUDE_MAX_OUTPUT_TOKENS'],
  transcribeModel: ['OPENAI_TRANSCRIBE_MODEL'],
  ocrModel: ['MISTRAL_OCR_MODEL'],
  mistralOrgId: ['MISTRAL_ORG_ID', 'MISTRAL_ORGANIZATION', 'MISTRAL_ORG']
};

export function getEnvValue(key) {
  const envKeys = ENV_MAPPINGS[key];
  if (!envKeys) return undefined;

  for (const envKey of envKeys) {
    const value = process.env[envKey];
    if (value !== undefined && value !== '') {
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }
  }

  return undefined;
}

