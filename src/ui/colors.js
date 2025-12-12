/**
 * Color Palette & Styling
 *
 * The "Midnight Ember" color system.
 */

import chalk from 'chalk';
import gradient from 'gradient-string';

// ═══════════════════════════════════════════════════════════════
// COLOR PALETTE
// ═══════════════════════════════════════════════════════════════

export const colors = {
  // Core text colors
  primary: '#FFFFFF',
  secondary: '#9CA3AF',
  muted: '#6B7280',
  dim: '#374151',

  // Accent colors
  accent: '#22D3EE',
  highlight: '#A78BFA',
  brand: '#F472B6',

  // Semantic colors
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  info: '#60A5FA',

  // Special
  gold: '#F59E0B',
  thinking: '#818CF8',
};

// RGB versions for ANSI sequences
export const rgb = {
  primary: [255, 255, 255],
  secondary: [156, 163, 175],
  muted: [107, 114, 128],
  dim: [55, 65, 81],
  accent: [34, 211, 238],
  highlight: [167, 139, 250],
  brand: [244, 114, 182],
  success: [52, 211, 153],
  warning: [251, 191, 36],
  error: [248, 113, 113],
  info: [96, 165, 250],
  gold: [245, 158, 11],
  thinking: [129, 140, 248],
  boxBorder: [75, 85, 99],
  boxBg: [17, 24, 39],
  boxText: [229, 231, 235],
};

// ═══════════════════════════════════════════════════════════════
// STYLED TEXT HELPERS
// ═══════════════════════════════════════════════════════════════

export const style = {
  primary: (text) => chalk.hex(colors.primary)(text),
  secondary: (text) => chalk.hex(colors.secondary)(text),
  muted: (text) => chalk.hex(colors.muted)(text),
  dim: (text) => chalk.hex(colors.dim)(text),
  accent: (text) => chalk.hex(colors.accent)(text),
  highlight: (text) => chalk.hex(colors.highlight)(text),
  brand: (text) => chalk.hex(colors.brand)(text),
  success: (text) => chalk.hex(colors.success)(text),
  warning: (text) => chalk.hex(colors.warning)(text),
  error: (text) => chalk.hex(colors.error)(text),
  info: (text) => chalk.hex(colors.info)(text),
  gold: (text) => chalk.hex(colors.gold)(text),
  thinking: (text) => chalk.hex(colors.thinking)(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  underline: (text) => chalk.underline(text),
  accentBold: (text) => chalk.hex(colors.accent).bold(text),
  successBold: (text) => chalk.hex(colors.success).bold(text),
  errorBold: (text) => chalk.hex(colors.error).bold(text),
  mutedItalic: (text) => chalk.hex(colors.muted).italic(text),
  header: (text) => chalk.hex(colors.primary).bold(text.toUpperCase().split('').join(' ')),
  link: (text) => chalk.hex(colors.accent).underline(text),
};

// ═══════════════════════════════════════════════════════════════
// GRADIENTS
// ═══════════════════════════════════════════════════════════════

export const gradients = {
  brand: gradient(['#F472B6', '#A78BFA', '#22D3EE']),
  thinking: gradient(['#818CF8', '#A78BFA', '#C4B5FD']),
  success: gradient(['#2DD4BF', '#34D399', '#4ADE80']),
  warm: gradient(['#F59E0B', '#F472B6']),
  cool: gradient(['#60A5FA', '#22D3EE']),
  rainbow: gradient.rainbow,
};

// ═══════════════════════════════════════════════════════════════
// ANSI UTILITIES
// ═══════════════════════════════════════════════════════════════

export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
  up: (n = 1) => `\x1b[${n}A`,
  down: (n = 1) => `\x1b[${n}B`,
  clearLine: '\x1b[2K',
  clearScreen: '\x1b[2J',
  moveTo: (x, y) => `\x1b[${y};${x}H`,
  fg: (r, g, b) => `\x1b[38;2;${r};${g};${b}m`,
  bg: (r, g, b) => `\x1b[48;2;${r};${g};${b}m`,
  color: ({ fg, bg }) => {
    const parts = [];
    if (fg) parts.push(`38;2;${fg[0]};${fg[1]};${fg[2]}`);
    if (bg) parts.push(`48;2;${bg[0]};${bg[1]};${bg[2]}`);
    if (!parts.length) return '';
    return `\x1b[${parts.join(';')}m`;
  },
};
