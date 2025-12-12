import { PROMPTS } from '../paths.js';

const STYLE_PRESETS = { musk: '', bukowski: '' };
const STYLE_ALIASES = {
  m: 'musk',
  mx: 'musk',
  max: 'musk',
  elon: 'musk',
  musk: 'musk',
  buk: 'bukowski',
  bukowski: 'bukowski',
  bk: 'bukowski'
};

export function normalizeStyle(value) {
  if (!value) return null;
  const key = value.toLowerCase();
  return STYLE_ALIASES[key] || (STYLE_PRESETS[key] ? key : null);
}

export function resolveAgentPromptPath(style) {
  const key = normalizeStyle(style) || 'bukowski';
  if (key === 'bukowski') return PROMPTS.bukowski;
  return PROMPTS.musk;
}

