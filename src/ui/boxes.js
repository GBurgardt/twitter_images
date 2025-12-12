/**
 * Box Components
 *
 * "Design is not just what it looks like and feels like.
 * Design is how it works." — Steve Jobs
 */

import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { style, symbols, spacing, ansi, rgb } from './theme.js';

// The one box style we need - rounded, elegant
const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  dividerLeft: '├',
  dividerRight: '┤',
};

/**
 * Create a simple box with content
 */
export function box(content, options = {}) {
  const {
    width: requestedWidth = null,
    widthRatio = 0.6,
    padding = 1,
    title = null,
  } = options;

  const termWidth = process.stdout.columns || 80;
  const boxWidth = requestedWidth || Math.min(termWidth - 4, Math.floor(termWidth * widthRatio));
  const contentWidth = boxWidth - 2 - padding * 2;

  const border = style.dim;
  const marginSize = Math.max(0, Math.floor((termWidth - boxWidth) / 2));
  const margin = ' '.repeat(marginSize);
  const pad = ' '.repeat(padding);

  const wrappedContent = wrapAnsi(content, contentWidth, { hard: true, trim: false });
  const contentLines = wrappedContent.split('\n');

  const lines = [];

  // Top border with optional title
  let topLine = BOX.horizontal.repeat(boxWidth - 2);
  if (title) {
    const titleText = ` ${title} `;
    const titleLen = stringWidth(titleText);
    const leftPad = Math.floor((boxWidth - 2 - titleLen) / 2);
    const rightPad = boxWidth - 2 - titleLen - leftPad;
    topLine = BOX.horizontal.repeat(leftPad) + style.accent(titleText) + BOX.horizontal.repeat(rightPad);
  }
  lines.push(`${margin}${border(BOX.topLeft)}${topLine}${border(BOX.topRight)}`);

  // Top padding
  for (let i = 0; i < padding; i++) {
    lines.push(`${margin}${border(BOX.vertical)}${' '.repeat(boxWidth - 2)}${border(BOX.vertical)}`);
  }

  // Content
  for (const line of contentLines) {
    const lineWidth = stringWidth(line);
    const rightPadding = Math.max(0, contentWidth - lineWidth);
    lines.push(`${margin}${border(BOX.vertical)}${pad}${line}${' '.repeat(rightPadding)}${pad}${border(BOX.vertical)}`);
  }

  // Bottom padding
  for (let i = 0; i < padding; i++) {
    lines.push(`${margin}${border(BOX.vertical)}${' '.repeat(boxWidth - 2)}${border(BOX.vertical)}`);
  }

  // Bottom border
  lines.push(`${margin}${border(BOX.bottomLeft)}${BOX.horizontal.repeat(boxWidth - 2)}${border(BOX.bottomRight)}`);

  return lines.join('\n');
}

/**
 * The result box - a moment of revelation
 *
 * Clean. Centered. Breathing room.
 * The content should feel like it's emerging from calm.
 */
export function resultBox(content, options = {}) {
  const {
    title = null,
    model = null,
    meta = null,
    widthRatio = 0.65,
  } = options;

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(termWidth - 4, Math.floor(termWidth * widthRatio));
  const contentWidth = boxWidth - 4;

  const borderColor = rgb.boxBorder;
  const textColor = rgb.boxText;

  const border = ansi.fg(...borderColor);
  const text = ansi.fg(...textColor);
  const reset = ansi.reset;

  const marginSize = Math.max(0, Math.floor((termWidth - boxWidth) / 2));
  const margin = ' '.repeat(marginSize);

  const wrappedContent = wrapAnsi(content, contentWidth, { hard: true, trim: false });
  const contentLines = wrappedContent.split('\n');

  const lines = [];

  // Breathing room before
  lines.push('');
  lines.push('');

  // Top border
  lines.push(`${margin}${border}${BOX.topLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.topRight}${reset}`);

  // Header with title and model (if provided)
  if (title || model) {
    const titleText = title || '';
    const modelText = model ? style.secondary(model) : '';
    const headerSpace = boxWidth - 4 - stringWidth(titleText) - (model ? stringWidth(model) : 0);
    const headerContent = `${style.primary(titleText)}${' '.repeat(Math.max(1, headerSpace))}${modelText}`;
    lines.push(`${margin}${border}${BOX.vertical}${reset} ${headerContent} ${border}${BOX.vertical}${reset}`);
    lines.push(`${margin}${border}${BOX.dividerLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.dividerRight}${reset}`);
  }

  // Empty line for breathing
  lines.push(`${margin}${border}${BOX.vertical}${reset}${' '.repeat(boxWidth - 2)}${border}${BOX.vertical}${reset}`);

  // Content - the revelation
  for (const line of contentLines) {
    const lineWidth = stringWidth(line);
    const padding = Math.max(0, contentWidth - lineWidth);
    lines.push(`${margin}${border}${BOX.vertical}${reset} ${text}${line}${' '.repeat(padding)}${reset} ${border}${BOX.vertical}${reset}`);
  }

  // Empty line for breathing
  lines.push(`${margin}${border}${BOX.vertical}${reset}${' '.repeat(boxWidth - 2)}${border}${BOX.vertical}${reset}`);

  // Footer with meta (if provided)
  if (meta) {
    lines.push(`${margin}${border}${BOX.dividerLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.dividerRight}${reset}`);
    const metaContent = style.secondary(`${symbols.success} ${meta}`);
    const metaWidth = stringWidth(meta) + 2;
    const metaPadding = Math.max(0, boxWidth - 4 - metaWidth);
    lines.push(`${margin}${border}${BOX.vertical}${reset} ${metaContent}${' '.repeat(metaPadding)} ${border}${BOX.vertical}${reset}`);
  }

  // Bottom border
  lines.push(`${margin}${border}${BOX.bottomLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.bottomRight}${reset}`);

  // Breathing room after
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

/**
 * Error box - clear, not alarming
 */
export function errorBox(content, options = {}) {
  return box(content, {
    title: options.title || 'Error',
    widthRatio: 0.5,
    ...options,
  });
}

/**
 * Success box
 */
export function successBox(content, options = {}) {
  return box(content, {
    title: options.title || 'Done',
    widthRatio: 0.5,
    ...options,
  });
}

/**
 * Info box
 */
export function infoBox(content, options = {}) {
  return box(content, {
    widthRatio: 0.5,
    ...options,
  });
}

/**
 * Warning box
 */
export function warningBox(content, options = {}) {
  return box(content, {
    title: options.title || 'Note',
    widthRatio: 0.5,
    ...options,
  });
}

/**
 * Simple divider
 */
export function divider(char = '─', options = {}) {
  const { widthRatio = 0.3 } = options;
  const termWidth = process.stdout.columns || 80;
  const lineWidth = Math.floor(termWidth * widthRatio);
  const marginSize = Math.floor((termWidth - lineWidth) / 2);
  const margin = ' '.repeat(marginSize);
  return `\n${margin}${style.dim(char.repeat(lineWidth))}\n`;
}

/**
 * Horizontal rule
 */
export function hr(options = {}) {
  return divider('─', { widthRatio: 0.4, ...options });
}

export default { box, resultBox, errorBox, successBox, infoBox, warningBox, divider, hr };
