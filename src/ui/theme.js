/**
 * TWX Design System
 *
 * "Simplicity is the ultimate sophistication." — Leonardo da Vinci
 */

import figures from 'figures';

// Re-export colors and styling
export { colors, rgb, style, gradients, ansi } from './colors.js';

// ═══════════════════════════════════════════════════════════════
// ASCII LOGO
// ═══════════════════════════════════════════════════════════════

// The signature TWX logo - memorable, with presence
const ASCII_LOGO = `████████╗██╗    ██╗██╗  ██╗
╚══██╔══╝██║    ██║╚██╗██╔╝
   ██║   ██║ █╗ ██║ ╚███╔╝
   ██║   ██║███╗██║ ██╔██╗
   ██║   ╚███╔███╔╝██╔╝ ██╗
   ╚═╝    ╚══╝╚══╝ ╚═╝  ╚═╝`;

// ═══════════════════════════════════════════════════════════════
// SYMBOLS (essential only)
// ═══════════════════════════════════════════════════════════════

export const symbols = {
  success: figures.tick,
  error: figures.cross,
  pointer: figures.pointer,
  bullet: figures.bullet,
  circle: figures.circle,
  circleFilled: figures.circleFilled,
  star: figures.star,
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  box: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    dividerLeft: '├',
    dividerRight: '┤',
  },
  ellipsis: '…',
  middot: '·',
};

// ═══════════════════════════════════════════════════════════════
// SPACING & LAYOUT (generous whitespace)
// ═══════════════════════════════════════════════════════════════

export const spacing = {
  indent: '  ',
  indent2: '    ',
  indent3: '      ',
  blank: '',
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
};

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT
// ═══════════════════════════════════════════════════════════════

export const env = {
  noColor: () => Boolean(process.env.NO_COLOR || process.env.TERM === 'dumb'),
  isTTY: () => Boolean(process.stdout.isTTY),
  unicode: () => process.platform !== 'win32' || Boolean(process.env.WT_SESSION),
};

// ═══════════════════════════════════════════════════════════════
// FORMATTED COMPONENTS
// ═══════════════════════════════════════════════════════════════

import { style, gradients } from './colors.js';

/**
 * The brand header with gradient ASCII logo
 * Creates a moment of visual impact
 */
export function brandHeader() {
  const logo = gradients.brand(ASCII_LOGO);
  const lines = logo.split('\n');

  // Center the logo
  const termWidth = process.stdout.columns || 80;
  const logoWidth = 28; // Width of the ASCII art
  const padding = Math.max(0, Math.floor((termWidth - logoWidth) / 2));
  const pad = ' '.repeat(padding);

  const centeredLogo = lines.map((line) => pad + line).join('\n');

  // Generous whitespace - let it breathe
  return `\n\n${centeredLogo}\n\n`;
}

/**
 * Simple, clean section header
 */
export function sectionHeader(text) {
  return `\n${spacing.indent}${style.primary(text)}\n`;
}

/**
 * Status line with icon
 */
export function statusLine(status, message) {
  const icons = {
    success: style.success(symbols.success),
    error: style.error(symbols.error),
    pending: style.secondary(symbols.circle),
    active: style.accent(symbols.circleFilled),
  };
  const icon = icons[status] || icons.pending;
  return `${spacing.indent}${icon} ${message}`;
}

/**
 * Meta information line
 */
export function metaLine(text) {
  return `${spacing.indent}${style.secondary(text)}`;
}

/**
 * The prompt symbol
 */
export function promptSymbol() {
  return style.accent('›');
}

/**
 * Relative time formatting
 */
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

/**
 * Number formatting
 */
export function formatNumber(num) {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Text truncation
 */
export function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + symbols.ellipsis;
}

/**
 * Text truncation at word boundary
 */
export function truncateWords(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > max * 0.6) return truncated.slice(0, lastSpace) + symbols.ellipsis;
  return truncated.slice(0, max - 1) + symbols.ellipsis;
}
