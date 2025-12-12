import { DEFAULTS } from './defaults.js';
import { getEnvValue } from './env.js';
import { readConfigFile, writeConfigFile, getCachedConfig, setCachedConfig } from './fileStore.js';

export async function loadConfig() {
  const cached = getCachedConfig();
  if (cached) return cached;

  const fileConfig = (await readConfigFile()) || {};
  const maxTokensEnv = getEnvValue('agentMaxOutputTokens');
  const parsedMaxTokens = Number(maxTokensEnv ?? fileConfig.agentMaxOutputTokens ?? DEFAULTS.agentMaxOutputTokens);
  const agentMaxOutputTokens = Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0 ? parsedMaxTokens : DEFAULTS.agentMaxOutputTokens;

  const config = {
    mistralApiKey: getEnvValue('mistralApiKey') || fileConfig.mistralApiKey || null,
    geminiApiKey: getEnvValue('geminiApiKey') || fileConfig.geminiApiKey || null,
    anthropicApiKey: getEnvValue('anthropicApiKey') || fileConfig.anthropicApiKey || null,
    openaiApiKey: getEnvValue('openaiApiKey') || fileConfig.openaiApiKey || null,
    redditClientId: getEnvValue('redditClientId') || fileConfig.redditClientId || null,
    redditClientSecret: getEnvValue('redditClientSecret') || fileConfig.redditClientSecret || null,
    redditUserAgent: getEnvValue('redditUserAgent') || fileConfig.redditUserAgent || null,
    mongodbUrl: getEnvValue('mongodbUrl') || fileConfig.mongodbUrl || 'mongodb://localhost:27017/twx_history',
    mistralOrgId: getEnvValue('mistralOrgId') || fileConfig.mistralOrgId || null,

    agentProvider: (getEnvValue('agentProvider') || fileConfig.agentProvider || DEFAULTS.agentProvider || 'gemini').toString().toLowerCase(),
    mode: getEnvValue('mode') || fileConfig.mode || DEFAULTS.mode,
    verbose: getEnvValue('verbose') || fileConfig.verbose || DEFAULTS.verbose,
    keepDownloads: getEnvValue('keepDownloads') || fileConfig.keepDownloads || DEFAULTS.keepDownloads,

    thinkingLevel: getEnvValue('thinkingLevel') || fileConfig.thinkingLevel || DEFAULTS.thinkingLevel,
    mediaResolution: getEnvValue('mediaResolution') || fileConfig.mediaResolution || DEFAULTS.mediaResolution,
    visionModel: getEnvValue('visionModel') || fileConfig.visionModel || 'gemini-3-pro-preview',
    agentModel: getEnvValue('agentModel') || fileConfig.agentModel || 'gpt-5.2',
    openaiReasoningEffort: (getEnvValue('openaiReasoningEffort') || fileConfig.openaiReasoningEffort || DEFAULTS.openaiReasoningEffort || 'xhigh')
      .toString()
      .toLowerCase(),
    agentMaxOutputTokens,
    transcribeModel: getEnvValue('transcribeModel') || fileConfig.transcribeModel || 'whisper-1',
    ocrModel: getEnvValue('ocrModel') || fileConfig.ocrModel || 'mistral-ocr-latest',

    whisperSegmentSeconds: fileConfig.whisperSegmentSeconds || DEFAULTS.whisperSegmentSeconds,
    whisperBitrate: fileConfig.whisperBitrate || DEFAULTS.whisperBitrate,
    whisperSampleRate: fileConfig.whisperSampleRate || DEFAULTS.whisperSampleRate
  };

  setCachedConfig(config);
  return config;
}

export async function saveConfigValue(key, value) {
  const fileConfig = (await readConfigFile()) || {};
  fileConfig[key] = value;
  return writeConfigFile(fileConfig);
}

export async function saveConfig(updates) {
  const fileConfig = (await readConfigFile()) || {};
  Object.assign(fileConfig, updates);
  return writeConfigFile(fileConfig);
}

export async function isConfigured() {
  const config = await loadConfig();
  return Boolean(config.mistralApiKey);
}

