/**
 * Config facade - stable API for the rest of the codebase.
 * Implementation is split into small modules under `src/config/`.
 */

export { loadConfig, saveConfigValue, saveConfig, isConfigured } from './config/core.js';
export { getMissingKeys, runSetup, resetConfig, showConfig } from './config/setup.js';
export { CONFIG_FILE, CONFIG_DIR } from './config/paths.js';

