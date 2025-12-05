/**
 * Configuración persistente para twx
 *
 * Prioridad de configuración:
 * 1. Variables de entorno (override)
 * 2. Archivo de configuración (~/.config/twx/config.json)
 * 3. Valores por defecto
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as clack from '@clack/prompts';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'twx');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Defaults
const DEFAULTS = {
  agentProvider: 'gemini',
  style: 'musk',
  mode: 'standard',
  verbose: false,
  keepDownloads: false,
  thinkingLevel: 'HIGH',
  mediaResolution: 'MEDIA_RESOLUTION_HIGH',
  agentMaxOutputTokens: 64000,
  whisperSegmentSeconds: 480,
  whisperBitrate: '48k',
  whisperSampleRate: '16000'
};

let cachedConfig = null;

/**
 * Lee la configuración del archivo
 */
async function readConfigFile() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    console.error('[config] Error leyendo config:', error.message);
    return null;
  }
}

/**
 * Escribe la configuración al archivo
 */
async function writeConfigFile(config) {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    cachedConfig = config;
    return true;
  } catch (error) {
    console.error('[config] Error guardando config:', error.message);
    return false;
  }
}

/**
 * Obtiene un valor de configuración con fallback a env vars
 */
function getEnvValue(key) {
  const envMappings = {
    mistralApiKey: ['MISTRAL_API_KEY'],
    geminiApiKey: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    anthropicApiKey: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    openaiApiKey: ['OPENAI_API_KEY'],
    mongodbUrl: ['MONGODB_URL', 'MONGO_URL', 'MONGO_URI'],
    agentProvider: ['TWX_AGENT_PROVIDER'],
    style: ['TWX_DEFAULT_STYLE'],
    mode: ['TWX_MODE'],
    verbose: ['TWX_DEBUG'],
    keepDownloads: ['TWX_KEEP_DOWNLOADS'],
    thinkingLevel: ['GEMINI_THINKING_LEVEL'],
    mediaResolution: ['GEMINI_MEDIA_RESOLUTION'],
    visionModel: ['GEMINI_VISION_MODEL'],
    agentModel: ['GEMINI_AGENT_MODEL'],
    agentMaxOutputTokens: ['AGENT_MAX_OUTPUT_TOKENS', 'GEMINI_MAX_OUTPUT_TOKENS', 'CLAUDE_MAX_OUTPUT_TOKENS'],
    transcribeModel: ['OPENAI_TRANSCRIBE_MODEL'],
    ocrModel: ['MISTRAL_OCR_MODEL'],
    mistralOrgId: ['MISTRAL_ORG_ID', 'MISTRAL_ORGANIZATION', 'MISTRAL_ORG']
  };

  const envKeys = envMappings[key];
  if (!envKeys) return undefined;

  for (const envKey of envKeys) {
    const value = process.env[envKey];
    if (value !== undefined && value !== '') {
      // Convertir strings a boolean si corresponde
      if (value === '1' || value === 'true') return true;
      if (value === '0' || value === 'false') return false;
      return value;
    }
  }
  return undefined;
}

/**
 * Carga la configuración completa
 */
export async function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const fileConfig = await readConfigFile() || {};
  const maxTokensEnv = getEnvValue('agentMaxOutputTokens');
  const parsedMaxTokens = Number(maxTokensEnv ?? fileConfig.agentMaxOutputTokens ?? DEFAULTS.agentMaxOutputTokens);
  const agentMaxOutputTokens = Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0 ? parsedMaxTokens : DEFAULTS.agentMaxOutputTokens;

  // Merge: defaults < fileConfig < env vars
  const config = {
    // API Keys
    mistralApiKey: getEnvValue('mistralApiKey') || fileConfig.mistralApiKey || null,
    geminiApiKey: getEnvValue('geminiApiKey') || fileConfig.geminiApiKey || null,
    anthropicApiKey: getEnvValue('anthropicApiKey') || fileConfig.anthropicApiKey || null,
    openaiApiKey: getEnvValue('openaiApiKey') || fileConfig.openaiApiKey || null,
    mongodbUrl: getEnvValue('mongodbUrl') || fileConfig.mongodbUrl || 'mongodb://localhost:27017/twx_history',
    mistralOrgId: getEnvValue('mistralOrgId') || fileConfig.mistralOrgId || null,

    // Preferences
    agentProvider: (getEnvValue('agentProvider') || fileConfig.agentProvider || DEFAULTS.agentProvider || 'gemini').toString().toLowerCase(),
    style: getEnvValue('style') || fileConfig.style || DEFAULTS.style,
    mode: getEnvValue('mode') || fileConfig.mode || DEFAULTS.mode,
    verbose: getEnvValue('verbose') || fileConfig.verbose || DEFAULTS.verbose,
    keepDownloads: getEnvValue('keepDownloads') || fileConfig.keepDownloads || DEFAULTS.keepDownloads,

    // Model settings
    thinkingLevel: getEnvValue('thinkingLevel') || fileConfig.thinkingLevel || DEFAULTS.thinkingLevel,
    mediaResolution: getEnvValue('mediaResolution') || fileConfig.mediaResolution || DEFAULTS.mediaResolution,
    visionModel: getEnvValue('visionModel') || fileConfig.visionModel || 'gemini-3-pro-preview',
    agentModel: getEnvValue('agentModel') || fileConfig.agentModel || 'gemini-3-pro-preview',
    agentMaxOutputTokens,
    transcribeModel: getEnvValue('transcribeModel') || fileConfig.transcribeModel || 'whisper-1',
    ocrModel: getEnvValue('ocrModel') || fileConfig.ocrModel || 'mistral-ocr-latest',

    // Whisper settings
    whisperSegmentSeconds: fileConfig.whisperSegmentSeconds || DEFAULTS.whisperSegmentSeconds,
    whisperBitrate: fileConfig.whisperBitrate || DEFAULTS.whisperBitrate,
    whisperSampleRate: fileConfig.whisperSampleRate || DEFAULTS.whisperSampleRate
  };

  cachedConfig = config;
  return config;
}

/**
 * Guarda un valor en la configuración
 */
export async function saveConfigValue(key, value) {
  const fileConfig = await readConfigFile() || {};
  fileConfig[key] = value;
  return writeConfigFile(fileConfig);
}

/**
 * Guarda múltiples valores
 */
export async function saveConfig(updates) {
  const fileConfig = await readConfigFile() || {};
  Object.assign(fileConfig, updates);
  return writeConfigFile(fileConfig);
}

/**
 * Verifica si la configuración está completa
 */
export async function isConfigured() {
  const config = await loadConfig();
  // Mínimo necesario: Mistral para OCR
  return Boolean(config.mistralApiKey);
}

/**
 * Verifica qué API keys faltan
 */
export async function getMissingKeys() {
  const config = await loadConfig();
  const missing = [];

  if (!config.mistralApiKey) {
    missing.push({ key: 'mistralApiKey', name: 'Mistral', required: true, purpose: 'leer texto de imágenes' });
  }
  if (config.agentProvider === 'gemini' && !config.geminiApiKey) {
    missing.push({ key: 'geminiApiKey', name: 'Gemini/Google', required: true, purpose: 'análisis con IA (proveedor Gemini)' });
  } else if (!config.geminiApiKey) {
    missing.push({ key: 'geminiApiKey', name: 'Gemini/Google', required: false, purpose: 'análisis con IA (opcional si usás Gemini)' });
  }
  if (config.agentProvider === 'claude' && !config.anthropicApiKey) {
    missing.push({ key: 'anthropicApiKey', name: 'Anthropic/Claude', required: true, purpose: 'análisis con IA (proveedor Claude)' });
  } else if (!config.anthropicApiKey) {
    missing.push({ key: 'anthropicApiKey', name: 'Anthropic/Claude', required: false, purpose: 'Claude como alternativo' });
  }
  if (!config.openaiApiKey) {
    missing.push({ key: 'openaiApiKey', name: 'OpenAI', required: false, purpose: 'transcribir audio/video' });
  }

  return missing;
}

/**
 * Setup interactivo de primera ejecución
 */
export async function runSetup(options = {}) {
  const { force = false } = options;

  if (!force && await isConfigured()) {
    return true;
  }

  console.log('');
  clack.intro('Welcome to twx');

  const missing = await getMissingKeys();

  if (missing.length === 0 && !force) {
    clack.outro('Already configured.');
    return true;
  }

  clack.log.info('I need some API keys to work.\n');

  const updates = {};

  // Mistral (required)
  const mistralKey = await clack.text({
    message: 'Mistral API key (for reading images)',
    placeholder: 'sk-...',
    validate: (value) => {
      if (!value || value.trim() === '') {
        return 'This key is required for OCR';
      }
    }
  });

  if (clack.isCancel(mistralKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  updates.mistralApiKey = mistralKey.trim();

  // Gemini (optional but recommended)
  const geminiKey = await clack.text({
    message: 'Google/Gemini API key (for AI analysis)',
    placeholder: 'AIza... (Enter to skip)',
    defaultValue: ''
  });

  if (clack.isCancel(geminiKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  if (geminiKey && geminiKey.trim()) {
    updates.geminiApiKey = geminiKey.trim();
  }

  // Anthropic/Claude (optional but recommended for Claude mode)
  const anthropicKey = await clack.text({
    message: 'Anthropic/Claude API key (for Claude mode)',
    placeholder: 'sk-ant-... (Enter to skip)',
    defaultValue: ''
  });

  if (clack.isCancel(anthropicKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  if (anthropicKey && anthropicKey.trim()) {
    updates.anthropicApiKey = anthropicKey.trim();
  }

  // OpenAI (optional)
  const openaiKey = await clack.text({
    message: 'OpenAI API key (for audio transcription)',
    placeholder: 'sk-... (Enter to skip)',
    defaultValue: ''
  });

  if (clack.isCancel(openaiKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  if (openaiKey && openaiKey.trim()) {
    updates.openaiApiKey = openaiKey.trim();
  }

  // Preferred style
  const style = await clack.select({
    message: 'How should I talk?',
    options: [
      { value: 'musk', label: 'Direct & technical', hint: 'Elon Musk style' },
      { value: 'bukowski', label: 'Raw & unfiltered', hint: 'Bukowski style' },
      { value: 'brief', label: 'Executive brief', hint: '3-5 bullets' },
      { value: 'raw', label: 'Data only', hint: 'no AI interpretation' }
    ]
  });

  if (clack.isCancel(style)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  updates.style = style;

  // Save
  const spinner = clack.spinner();
  spinner.start('Saving configuration...');

  const saved = await saveConfig(updates);

  if (saved) {
    spinner.stop('Configuration saved');
    clack.log.success(`File: ${CONFIG_FILE}`);
    clack.outro('Ready. Now use: twx <url>');
    return true;
  } else {
    spinner.stop('Error saving configuration');
    clack.log.error('Could not save configuration. Check permissions.');
    return false;
  }
}

/**
 * Resetea la configuración
 */
export async function resetConfig() {
  try {
    await fs.unlink(CONFIG_FILE);
    cachedConfig = null;
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    return false;
  }
}

/**
 * Muestra la configuración actual (sin mostrar keys completas)
 */
export async function showConfig() {
  const config = await loadConfig();

  const maskKey = (key) => {
    if (!key) return '(not set)';
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '...' + key.slice(-4);
  };

  console.log('');
  clack.intro('twx configuration');

  clack.log.info(`File: ${CONFIG_FILE}\n`);

  console.log('  API Keys:');
  console.log(`    Mistral:  ${maskKey(config.mistralApiKey)}`);
  console.log(`    Gemini:   ${maskKey(config.geminiApiKey)}`);
  console.log(`    Anthropic: ${maskKey(config.anthropicApiKey)}`);
  console.log(`    OpenAI:   ${maskKey(config.openaiApiKey)}`);
  console.log('');
  console.log('  Preferences:');
  console.log(`    Agent:    ${config.agentProvider} (${config.agentModel || 'auto'})`);
  console.log(`    Max out:  ${config.agentMaxOutputTokens} tokens`);
  console.log(`    Style:    ${config.style}`);
  console.log(`    Mode:     ${config.mode}`);
  console.log(`    Verbose:  ${config.verbose ? 'yes' : 'no'}`);
  console.log('');

  clack.outro('Use "twx config --reset" to reconfigure');
}

export { CONFIG_FILE, CONFIG_DIR };
