import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'twx');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

