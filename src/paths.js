import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const DEFAULT_SESSION_LOG = path.join(PROJECT_ROOT, 'current_session.txt');
export const PROMPTS = {
  musk: path.join(PROJECT_ROOT, 'prompts/agent_prompt_musk.txt'),
  bukowski: path.join(PROJECT_ROOT, 'prompts/agent_prompt_bukowski.txt')
};

