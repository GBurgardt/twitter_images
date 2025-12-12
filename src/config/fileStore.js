import fs from 'node:fs/promises';
import { CONFIG_DIR, CONFIG_FILE } from './paths.js';

let cachedConfig = null;

export async function readConfigFile() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    console.error('[config] Error leyendo config:', error.message);
    return null;
  }
}

export async function writeConfigFile(config) {
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

export function getCachedConfig() {
  return cachedConfig;
}

export function setCachedConfig(next) {
  cachedConfig = next;
}

