/**
 * TWX Design System - "Midnight Ember"
 *
 * Central theme module that re-exports all design tokens.
 */

import figures from 'figures';

// Re-export colors and styling
export { colors, rgb, style, gradients, ansi } from './colors.js';

// ═══════════════════════════════════════════════════════════════
// SYMBOLS & ICONS
// ═══════════════════════════════════════════════════════════════

export const symbols = {
  success: figures.tick,
  error: figures.cross,
  warning: figures.warning,
  info: figures.info,
  pointer: figures.pointer,
  arrowRight: figures.arrowRight,
  arrowLeft: figures.arrowLeft,
  arrowUp: figures.arrowUp,
  arrowDown: figures.arrowDown,
  bullet: figures.bullet,
  circle: figures.circle,
  circleFilled: figures.circleFilled,
  square: figures.square,
  squareFilled: '◼',
  star: figures.star,
  starEmpty: '☆',
  heart: figures.heart,
  play: figures.play,
  spinner: ['◐', '◓', '◑', '◒'],
  spinnerDots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  spinnerArc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  box: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    dTopLeft: '╔',
    dTopRight: '╗',
    dBottomLeft: '╚',
    dBottomRight: '╝',
    dHorizontal: '═',
    dVertical: '║',
  },
  ellipsis: '…',
  middot: '·',
  dash: '—',
  lambda: 'λ',
};

// ═══════════════════════════════════════════════════════════════
// SPACING & LAYOUT
// ═══════════════════════════════════════════════════════════════

export const spacing = {
  indent: '  ',
  indent2: '    ',
  indent3: '      ',
  getWidth: () => process.stdout.columns || 80,
  getContentWidth: (ratio = 0.8) => {
    const cols = process.stdout.columns || 80;
    return Math.max(40, Math.floor(cols * ratio));
  },
  line: (char = '─', width = null) => {
    const w = width || spacing.getContentWidth();
    return char.repeat(w);
  },
  centerPad: (contentWidth) => {
    const cols = process.stdout.columns || 80;
    const margin = Math.max(0, Math.floor((cols - contentWidth) / 2));
    return ' '.repeat(margin);
  },
  blank: '',
};

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT CHECKS
// ═══════════════════════════════════════════════════════════════

export const env = {
  noColor: () => Boolean(process.env.NO_COLOR || process.env.TERM === 'dumb'),
  isTTY: () => Boolean(process.stdout.isTTY),
  unicode: () => process.platform !== 'win32' || Boolean(process.env.WT_SESSION),
  safeSymbols: () => ({
    success: env.unicode() ? symbols.success : '+',
    error: env.unicode() ? symbols.error : 'x',
    warning: env.unicode() ? symbols.warning : '!',
    bullet: env.unicode() ? symbols.bullet : '*',
    pointer: env.unicode() ? symbols.pointer : '>',
  }),
};

// ═══════════════════════════════════════════════════════════════
// FORMATTED COMPONENTS (import style and gradients locally to avoid circular deps)
// ═══════════════════════════════════════════════════════════════

import { style, gradients } from './colors.js';

export function brandHeader() {
  const logo = gradients.brand('T W X');
  const underline = style.dim('─────');
  return `\n${spacing.indent}${logo}\n${spacing.indent}${underline}\n`;
}

export function sectionHeader(text, icon = null) {
  const iconStr = icon ? `${icon} ` : '';
  return `\n${spacing.indent}${iconStr}${style.header(text)}\n`;
}

export function progressLine(current, total, label = '') {
  const ratio = Math.min(1, current / total);
  const width = 20;
  const filled = Math.round(width * ratio);
  const empty = width - filled;
  const bar = style.accent('█'.repeat(filled)) + style.dim('░'.repeat(empty));
  const percent = style.secondary(`${Math.round(ratio * 100)}%`);
  const labelStr = label ? style.muted(` ${symbols.middot} ${label}`) : '';
  return `${bar} ${percent}${labelStr}`;
}

export function statusLine(status, message) {
  const icons = {
    success: style.success(symbols.success),
    error: style.error(symbols.error),
    warning: style.warning(symbols.warning),
    info: style.info(symbols.info),
    pending: style.muted(symbols.circle),
    active: style.accent(symbols.circleFilled),
  };
  const icon = icons[status] || icons.info;
  return `${spacing.indent}${icon} ${message}`;
}

export function metaLine(text) {
  return `${spacing.indent}${style.muted(text)}`;
}

export function promptSymbol() {
  return style.accent('twx›');
}

export function relativeTime(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;
  const day = date.getDate();
  const month = date.toLocaleString('en', { month: 'short' });
  return `${day} ${month}`;
}

export function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

export function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + symbols.ellipsis;
}

export function truncateWords(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > max * 0.6) return truncated.slice(0, lastSpace) + symbols.ellipsis;
  return truncated.slice(0, max - 1) + symbols.ellipsis;
}
