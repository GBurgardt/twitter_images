/**
 * Color Palette & Styling
 *
 * "Less, but better." — Dieter Rams
 *
 * Reduced to 5 essential colors per Jobs philosophy:
 * 1. Primary (white) - main text
 * 2. Secondary (gray) - supporting text
 * 3. Accent (cyan) - ONE highlight color
 * 4. Success (green) - positive states only
 * 5. Error (red) - negative states only
 */

import chalk from 'chalk';
import gradient from 'gradient-string';

// ═══════════════════════════════════════════════════════════════
// ESSENTIAL COLOR PALETTE (5 colors only)
// ═══════════════════════════════════════════════════════════════

export const colors = {
  // Text hierarchy
  primary: '#FFFFFF',
  secondary: '#6B7280',
  dim: '#374151',

  // The ONE accent
  accent: '#22D3EE',

  // States only
  success: '#34D399',
  error: '#F87171',
};

// RGB versions for ANSI sequences
export const rgb = {
  primary: [255, 255, 255],
  secondary: [107, 114, 128],
  dim: [55, 65, 81],
  accent: [34, 211, 238],
  success: [52, 211, 153],
  error: [248, 113, 113],
  // Box styling uses secondary tones
  boxBorder: [55, 65, 81],
  boxText: [229, 231, 235],
};

// ═══════════════════════════════════════════════════════════════
// STYLED TEXT HELPERS (simplified)
// ═══════════════════════════════════════════════════════════════

export const style = {
  // Text hierarchy
  primary: (text) => chalk.hex(colors.primary)(text),
  secondary: (text) => chalk.hex(colors.secondary)(text),
  dim: (text) => chalk.hex(colors.dim)(text),

  // The ONE accent
  accent: (text) => chalk.hex(colors.accent)(text),

  // States
  success: (text) => chalk.hex(colors.success)(text),
  error: (text) => chalk.hex(colors.error)(text),

  // Typography
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),

  // Combinations (minimal)
  accentBold: (text) => chalk.hex(colors.accent).bold(text),

  // Legacy aliases (for compatibility, maps to simplified palette)
  muted: (text) => chalk.hex(colors.secondary)(text),
  warning: (text) => chalk.hex(colors.accent)(text),
  info: (text) => chalk.hex(colors.accent)(text),
  highlight: (text) => chalk.hex(colors.accent)(text),
  brand: (text) => chalk.hex(colors.accent)(text),
  gold: (text) => chalk.hex(colors.accent)(text),
  thinking: (text) => chalk.hex(colors.accent)(text),
  link: (text) => chalk.hex(colors.accent)(text),

  // Header style - clean, not screaming
  header: (text) => chalk.hex(colors.primary).bold(text),
};

// ═══════════════════════════════════════════════════════════════
// GRADIENTS (brand identity only)
// ═══════════════════════════════════════════════════════════════

export const gradients = {
  // The signature gradient for logo and special moments
  brand: gradient(['#F472B6', '#A78BFA', '#22D3EE']),
  // Alias for compatibility
  thinking: gradient(['#F472B6', '#A78BFA', '#22D3EE']),
  cool: gradient(['#60A5FA', '#22D3EE']),
};

// ═══════════════════════════════════════════════════════════════
// ANSI UTILITIES
// ═══════════════════════════════════════════════════════════════

export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
  up: (n = 1) => `\x1b[${n}A`,
  down: (n = 1) => `\x1b[${n}B`,
  clearLine: '\x1b[2K',
  clearScreen: '\x1b[2J',
  moveTo: (x, y) => `\x1b[${y};${x}H`,
  fg: (r, g, b) => `\x1b[38;2;${r};${g};${b}m`,
  bg: (r, g, b) => `\x1b[48;2;${r};${g};${b}m`,
};
