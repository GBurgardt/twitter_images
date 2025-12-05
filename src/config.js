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
  style: 'musk',
  mode: 'standard',
  verbose: false,
  keepDownloads: false,
  thinkingLevel: 'HIGH',
  mediaResolution: 'MEDIA_RESOLUTION_HIGH',
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
    openaiApiKey: ['OPENAI_API_KEY'],
    mongodbUrl: ['MONGODB_URL', 'MONGO_URL', 'MONGO_URI'],
    style: ['TWX_DEFAULT_STYLE'],
    mode: ['TWX_MODE'],
    verbose: ['TWX_DEBUG'],
    keepDownloads: ['TWX_KEEP_DOWNLOADS'],
    thinkingLevel: ['GEMINI_THINKING_LEVEL'],
    mediaResolution: ['GEMINI_MEDIA_RESOLUTION'],
    visionModel: ['GEMINI_VISION_MODEL'],
    agentModel: ['GEMINI_AGENT_MODEL'],
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

  // Merge: defaults < fileConfig < env vars
  const config = {
    // API Keys
    mistralApiKey: getEnvValue('mistralApiKey') || fileConfig.mistralApiKey || null,
    geminiApiKey: getEnvValue('geminiApiKey') || fileConfig.geminiApiKey || null,
    openaiApiKey: getEnvValue('openaiApiKey') || fileConfig.openaiApiKey || null,
    mongodbUrl: getEnvValue('mongodbUrl') || fileConfig.mongodbUrl || 'mongodb://localhost:27017/twx_history',
    mistralOrgId: getEnvValue('mistralOrgId') || fileConfig.mistralOrgId || null,

    // Preferences
    style: getEnvValue('style') || fileConfig.style || DEFAULTS.style,
    mode: getEnvValue('mode') || fileConfig.mode || DEFAULTS.mode,
    verbose: getEnvValue('verbose') || fileConfig.verbose || DEFAULTS.verbose,
    keepDownloads: getEnvValue('keepDownloads') || fileConfig.keepDownloads || DEFAULTS.keepDownloads,

    // Model settings
    thinkingLevel: getEnvValue('thinkingLevel') || fileConfig.thinkingLevel || DEFAULTS.thinkingLevel,
    mediaResolution: getEnvValue('mediaResolution') || fileConfig.mediaResolution || DEFAULTS.mediaResolution,
    visionModel: getEnvValue('visionModel') || fileConfig.visionModel || 'gemini-3-pro-preview',
    agentModel: getEnvValue('agentModel') || fileConfig.agentModel || 'gemini-3-pro-preview',
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
  if (!config.geminiApiKey) {
    missing.push({ key: 'geminiApiKey', name: 'Gemini/Google', required: false, purpose: 'análisis con IA' });
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
  clack.intro('Bienvenido a twx');

  const missing = await getMissingKeys();

  if (missing.length === 0 && !force) {
    clack.outro('Ya está todo configurado.');
    return true;
  }

  clack.log.info('Necesito algunas claves API para funcionar.\n');

  const updates = {};

  // Mistral (requerido)
  const mistralKey = await clack.text({
    message: 'Tu clave de Mistral (para leer imágenes)',
    placeholder: 'sk-...',
    validate: (value) => {
      if (!value || value.trim() === '') {
        return 'Esta clave es requerida para el OCR';
      }
    }
  });

  if (clack.isCancel(mistralKey)) {
    clack.cancel('Setup cancelado.');
    process.exit(0);
  }
  updates.mistralApiKey = mistralKey.trim();

  // Gemini (opcional pero recomendado)
  const geminiKey = await clack.text({
    message: 'Tu clave de Google/Gemini (para análisis IA)',
    placeholder: 'AIza... (Enter para omitir)',
    defaultValue: ''
  });

  if (clack.isCancel(geminiKey)) {
    clack.cancel('Setup cancelado.');
    process.exit(0);
  }
  if (geminiKey && geminiKey.trim()) {
    updates.geminiApiKey = geminiKey.trim();
  }

  // OpenAI (opcional)
  const openaiKey = await clack.text({
    message: 'Tu clave de OpenAI (para transcribir audio)',
    placeholder: 'sk-... (Enter para omitir)',
    defaultValue: ''
  });

  if (clack.isCancel(openaiKey)) {
    clack.cancel('Setup cancelado.');
    process.exit(0);
  }
  if (openaiKey && openaiKey.trim()) {
    updates.openaiApiKey = openaiKey.trim();
  }

  // Estilo preferido
  const style = await clack.select({
    message: '¿Cómo querés que te hable?',
    options: [
      { value: 'musk', label: 'Directo y técnico', hint: 'estilo Elon Musk' },
      { value: 'bukowski', label: 'Crudo y sin filtro', hint: 'estilo Bukowski' },
      { value: 'brief', label: 'Brief ejecutivo', hint: '3-5 bullets concisos' },
      { value: 'raw', label: 'Solo datos', hint: 'sin interpretación IA' }
    ]
  });

  if (clack.isCancel(style)) {
    clack.cancel('Setup cancelado.');
    process.exit(0);
  }
  updates.style = style;

  // Guardar
  const spinner = clack.spinner();
  spinner.start('Guardando configuración...');

  const saved = await saveConfig(updates);

  if (saved) {
    spinner.stop('Configuración guardada');
    clack.log.success(`Archivo: ${CONFIG_FILE}`);
    clack.outro('Listo. Ahora podés usar: twx <url>');
    return true;
  } else {
    spinner.stop('Error guardando configuración');
    clack.log.error('No pude guardar la configuración. Revisá los permisos.');
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
    if (!key) return '(no configurada)';
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '...' + key.slice(-4);
  };

  console.log('');
  clack.intro('Configuración de twx');

  clack.log.info(`Archivo: ${CONFIG_FILE}\n`);

  console.log('  API Keys:');
  console.log(`    Mistral:  ${maskKey(config.mistralApiKey)}`);
  console.log(`    Gemini:   ${maskKey(config.geminiApiKey)}`);
  console.log(`    OpenAI:   ${maskKey(config.openaiApiKey)}`);
  console.log('');
  console.log('  Preferencias:');
  console.log(`    Estilo:   ${config.style}`);
  console.log(`    Modo:     ${config.mode}`);
  console.log(`    Verbose:  ${config.verbose ? 'sí' : 'no'}`);
  console.log('');

  clack.outro('Usá "twx config --reset" para reconfigurar');
}

export { CONFIG_FILE, CONFIG_DIR };
