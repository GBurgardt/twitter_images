import fs from 'node:fs/promises';
import * as clack from '@clack/prompts';
import { CONFIG_FILE } from './paths.js';
import { loadConfig, isConfigured, saveConfig } from './core.js';
import { setCachedConfig } from './fileStore.js';

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
  if (config.agentProvider === 'openai' && !config.openaiApiKey) {
    missing.push({ key: 'openaiApiKey', name: 'OpenAI', required: true, purpose: 'análisis con IA (proveedor OpenAI)' });
  } else if (!config.openaiApiKey) {
    missing.push({ key: 'openaiApiKey', name: 'OpenAI', required: false, purpose: 'OpenAI (alternativo) + transcribir audio/video' });
  }
  if (!config.redditClientId || !config.redditClientSecret) {
    missing.push({ key: 'redditKeys', name: 'Reddit', required: false, purpose: 'recuperar texto de posts vía PRAW' });
  }

  return missing;
}

export async function runSetup(options = {}) {
  const { force = false } = options;

  if (!force && (await isConfigured())) {
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

  const mistralKey = await clack.text({
    message: 'Mistral API key (for reading images)',
    placeholder: 'sk-...',
    validate: (value) => {
      if (!value || value.trim() === '') return 'This key is required for OCR';
    }
  });

  if (clack.isCancel(mistralKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  updates.mistralApiKey = mistralKey.trim();

  const geminiKey = await clack.text({
    message: 'Google/Gemini API key (for AI analysis)',
    placeholder: 'AIza... (Enter to skip)',
    defaultValue: ''
  });
  if (clack.isCancel(geminiKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  if (geminiKey && geminiKey.trim()) updates.geminiApiKey = geminiKey.trim();

  const anthropicKey = await clack.text({
    message: 'Anthropic/Claude API key (for Claude mode)',
    placeholder: 'sk-ant-... (Enter to skip)',
    defaultValue: ''
  });
  if (clack.isCancel(anthropicKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  if (anthropicKey && anthropicKey.trim()) updates.anthropicApiKey = anthropicKey.trim();

  const openaiKey = await clack.text({
    message: 'OpenAI API key (for audio transcription)',
    placeholder: 'sk-... (Enter to skip)',
    defaultValue: ''
  });
  if (clack.isCancel(openaiKey)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  if (openaiKey && openaiKey.trim()) updates.openaiApiKey = openaiKey.trim();

  const redditClientId = await clack.text({
    message: 'Reddit client_id (for PRAW text fetch)',
    placeholder: '(Enter to skip)',
    defaultValue: ''
  });
  if (clack.isCancel(redditClientId)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  const redditClientSecret = await clack.text({
    message: 'Reddit client_secret (for PRAW text fetch)',
    placeholder: '(Enter to skip)',
    defaultValue: ''
  });
  if (clack.isCancel(redditClientSecret)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  const redditUserAgent = await clack.text({
    message: 'Reddit user agent (for PRAW text fetch)',
    placeholder: 'twx-reddit/0.1 (Enter to skip)',
    defaultValue: 'twx-reddit/0.1'
  });
  if (clack.isCancel(redditUserAgent)) {
    clack.cancel('Setup cancelled.');
    process.exit(0);
  }
  if (redditClientId && redditClientId.trim() && redditClientSecret && redditClientSecret.trim()) {
    updates.redditClientId = redditClientId.trim();
    updates.redditClientSecret = redditClientSecret.trim();
    updates.redditUserAgent = redditUserAgent?.trim() || 'twx-reddit/0.1';
  }

  const spinner = clack.spinner();
  spinner.start('Saving configuration...');

  const saved = await saveConfig(updates);
  if (saved) {
    spinner.stop('Configuration saved');
    clack.log.success(`File: ${CONFIG_FILE}`);
    clack.outro('Ready. Now use: twx <url>');
    return true;
  }

  spinner.stop('Error saving configuration');
  clack.log.error('Could not save configuration. Check permissions.');
  return false;
}

export async function resetConfig() {
  try {
    await fs.unlink(CONFIG_FILE);
    setCachedConfig(null);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    return false;
  }
}

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
  console.log(`    Reddit:   ${maskKey(config.redditClientId)}/${maskKey(config.redditClientSecret)}`);
  console.log('');
  console.log('  Preferences:');
  console.log(`    Agent:    ${config.agentProvider} (${config.agentModel || 'auto'})`);
  if (config.agentProvider === 'openai') {
    console.log(`    Reason:   ${config.openaiReasoningEffort || 'xhigh'}`);
  }
  console.log(`    Max out:  ${config.agentMaxOutputTokens} tokens`);
  console.log(`    Mode:     ${config.mode}`);
  console.log(`    Verbose:  ${config.verbose ? 'yes' : 'no'}`);
  console.log('');

  clack.outro('Use "twx config --reset" to reconfigure');
}

