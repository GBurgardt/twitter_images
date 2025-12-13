import { PROMPTS } from '../paths.js';

const STYLE_PRESETS = { musk: '', bukowski: '', nunc: '' };
const STYLE_ALIASES = {
  m: 'musk',
  mx: 'musk',
  max: 'musk',
  elon: 'musk',
  musk: 'musk',
  buk: 'bukowski',
  bukowski: 'bukowski',
  bk: 'bukowski',
  nunc: 'nunc',
  nunca: 'nunc',
  easy: 'nunc',
  claro: 'nunc',
  simple: 'nunc',
  sinvueltas: 'nunc',
  'sin-vueltas': 'nunc',
  'sin_vueltas': 'nunc'
};

export function normalizeStyle(value) {
  if (!value) return null;
  const key = value.toLowerCase();
  return STYLE_ALIASES[key] || (STYLE_PRESETS[key] ? key : null);
}

export function resolveAgentPromptPath(style) {
  const key = normalizeStyle(style) || 'bukowski';
  if (key === 'bukowski') return PROMPTS.bukowski;
  if (key === 'nunc') return PROMPTS.nunc;
  return PROMPTS.musk;
}
