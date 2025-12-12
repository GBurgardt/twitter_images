/**
 * Elegant Box Components
 *
 * Beautiful bordered boxes for displaying content.
 * Supports headers, footers, and streaming content.
 */

import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { style, symbols, spacing, ansi, rgb, gradients } from './theme.js';

// Box style presets
const BOX_STYLES = {
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    dividerLeft: '├',
    dividerRight: '┤',
  },
  sharp: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
    dividerLeft: '├',
    dividerRight: '┤',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    dividerLeft: '╠',
    dividerRight: '╣',
  },
  heavy: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
    dividerLeft: '┣',
    dividerRight: '┫',
  },
  minimal: {
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
    horizontal: '─',
    vertical: ' ',
    dividerLeft: ' ',
    dividerRight: ' ',
  },
};

/**
 * Create a static box with content
 */
export function box(content, options = {}) {
  const {
    width: requestedWidth = null,
    widthRatio = 0.7,
    padding = 1,
    margin = 0,
    title = null,
    footer = null,
    boxStyle = 'rounded',
    borderColor = 'dim',
    titleColor = 'accent',
    footerColor = 'muted',
    align = 'left',
  } = options;

  const termWidth = process.stdout.columns || 80;
  const boxWidth = requestedWidth || Math.min(termWidth - margin * 2, Math.floor(termWidth * widthRatio));
  const contentWidth = boxWidth - 2 - padding * 2; // borders + padding
  const chars = BOX_STYLES[boxStyle] || BOX_STYLES.rounded;

  const borderStyle = style[borderColor] || style.dim;
  const titleStyle = style[titleColor] || style.accent;
  const footerStyle = style[footerColor] || style.muted;

  const marginStr = ' '.repeat(margin);
  const paddingStr = ' '.repeat(padding);

  // Wrap and prepare content lines
  const wrappedContent = wrapAnsi(content, contentWidth, { hard: true, trim: false });
  const contentLines = wrappedContent.split('\n');

  // Build lines
  const lines = [];

  // Top border with optional title
  let topBorder = chars.horizontal.repeat(boxWidth - 2);
  if (title) {
    const titleText = ` ${title} `;
    const titleLen = stringWidth(titleText);
    const leftPad = Math.floor((boxWidth - 2 - titleLen) / 2);
    const rightPad = boxWidth - 2 - titleLen - leftPad;
    topBorder = chars.horizontal.repeat(leftPad) + titleStyle(titleText) + chars.horizontal.repeat(rightPad);
  }
  lines.push(`${marginStr}${borderStyle(chars.topLeft)}${topBorder}${borderStyle(chars.topRight)}`);

  // Top padding
  for (let i = 0; i < padding; i++) {
    const emptyLine = ' '.repeat(boxWidth - 2);
    lines.push(`${marginStr}${borderStyle(chars.vertical)}${emptyLine}${borderStyle(chars.vertical)}`);
  }

  // Content lines
  for (const line of contentLines) {
    const lineWidth = stringWidth(line);
    let paddedLine;

    if (align === 'center') {
      const leftSpace = Math.floor((contentWidth - lineWidth) / 2);
      const rightSpace = contentWidth - lineWidth - leftSpace;
      paddedLine = ' '.repeat(leftSpace) + line + ' '.repeat(rightSpace);
    } else if (align === 'right') {
      paddedLine = ' '.repeat(contentWidth - lineWidth) + line;
    } else {
      paddedLine = line + ' '.repeat(Math.max(0, contentWidth - lineWidth));
    }

    lines.push(`${marginStr}${borderStyle(chars.vertical)}${paddingStr}${paddedLine}${paddingStr}${borderStyle(chars.vertical)}`);
  }

  // Bottom padding
  for (let i = 0; i < padding; i++) {
    const emptyLine = ' '.repeat(boxWidth - 2);
    lines.push(`${marginStr}${borderStyle(chars.vertical)}${emptyLine}${borderStyle(chars.vertical)}`);
  }

  // Bottom border with optional footer
  let bottomBorder = chars.horizontal.repeat(boxWidth - 2);
  if (footer) {
    const footerText = ` ${footer} `;
    const footerLen = stringWidth(footerText);
    const leftPad = Math.floor((boxWidth - 2 - footerLen) / 2);
    const rightPad = boxWidth - 2 - footerLen - leftPad;
    bottomBorder = chars.horizontal.repeat(leftPad) + footerStyle(footerText) + chars.horizontal.repeat(rightPad);
  }
  lines.push(`${marginStr}${borderStyle(chars.bottomLeft)}${bottomBorder}${borderStyle(chars.bottomRight)}`);

  return lines.join('\n');
}

/**
 * Create a result box specifically for agent output
 */
export function resultBox(content, options = {}) {
  const {
    title = 'ANALYSIS',
    model = null,
    meta = null,
    widthRatio = 0.7,
  } = options;

  const termWidth = process.stdout.columns || 80;
  const boxWidth = Math.min(termWidth - 4, Math.floor(termWidth * widthRatio));
  const contentWidth = boxWidth - 4; // borders + minimal padding

  const borderColor = rgb.boxBorder;
  const textColor = rgb.boxText;

  const border = ansi.fg(...borderColor);
  const text = ansi.fg(...textColor);
  const reset = ansi.reset;

  const chars = BOX_STYLES.rounded;

  // Calculate margin for centering
  const marginSize = Math.max(0, Math.floor((termWidth - boxWidth) / 2));
  const margin = ' '.repeat(marginSize);

  // Wrap content
  const wrappedContent = wrapAnsi(content, contentWidth, { hard: true, trim: false });
  const contentLines = wrappedContent.split('\n');

  const lines = [];

  // Header line with title and model
  const titleText = title;
  const modelText = model || '';
  const headerSpace = boxWidth - 4 - stringWidth(titleText) - stringWidth(modelText);
  const headerContent = `${style.header(titleText)}${' '.repeat(Math.max(1, headerSpace))}${style.muted(modelText)}`;

  lines.push('');
  lines.push(`${margin}${border}${chars.topLeft}${chars.horizontal.repeat(boxWidth - 2)}${chars.topRight}${reset}`);
  lines.push(`${margin}${border}${chars.vertical}${reset} ${headerContent} ${border}${chars.vertical}${reset}`);
  lines.push(`${margin}${border}${chars.dividerLeft}${chars.horizontal.repeat(boxWidth - 2)}${chars.dividerRight}${reset}`);

  // Content
  for (const line of contentLines) {
    const lineWidth = stringWidth(line);
    const padding = Math.max(0, contentWidth - lineWidth);
    lines.push(`${margin}${border}${chars.vertical}${reset} ${text}${line}${' '.repeat(padding)}${reset} ${border}${chars.vertical}${reset}`);
  }

  // Footer with meta
  if (meta) {
    lines.push(`${margin}${border}${chars.dividerLeft}${chars.horizontal.repeat(boxWidth - 2)}${chars.dividerRight}${reset}`);
    const metaContent = style.muted(`${symbols.success} ${meta}`);
    const metaWidth = stringWidth(meta) + 2;
    const metaPadding = Math.max(0, boxWidth - 4 - metaWidth);
    lines.push(`${margin}${border}${chars.vertical}${reset} ${metaContent}${' '.repeat(metaPadding)} ${border}${chars.vertical}${reset}`);
  }

  lines.push(`${margin}${border}${chars.bottomLeft}${chars.horizontal.repeat(boxWidth - 2)}${chars.bottomRight}${reset}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Create a simple info box
 */
export function infoBox(content, options = {}) {
  return box(content, {
    boxStyle: 'rounded',
    borderColor: 'info',
    padding: 1,
    ...options,
  });
}

/**
 * Create a warning box
 */
export function warningBox(content, options = {}) {
  return box(content, {
    boxStyle: 'rounded',
    borderColor: 'warning',
    padding: 1,
    title: options.title || 'Warning',
    titleColor: 'warning',
    ...options,
  });
}

/**
 * Create an error box
 */
export function errorBox(content, options = {}) {
  return box(content, {
    boxStyle: 'rounded',
    borderColor: 'error',
    padding: 1,
    title: options.title || 'Error',
    titleColor: 'error',
    ...options,
  });
}

/**
 * Create a success box
 */
export function successBox(content, options = {}) {
  return box(content, {
    boxStyle: 'rounded',
    borderColor: 'success',
    padding: 1,
    title: options.title || 'Success',
    titleColor: 'success',
    ...options,
  });
}

/**
 * Simple divider line
 */
export function divider(char = '─', options = {}) {
  const { width: requestedWidth = null, widthRatio = 0.5, color = 'dim', margin = 2 } = options;
  const termWidth = process.stdout.columns || 80;
  const lineWidth = requestedWidth || Math.floor(termWidth * widthRatio);
  const marginStr = ' '.repeat(margin);
  const line = char.repeat(lineWidth);
  return `\n${marginStr}${style[color](line)}\n`;
}

/**
 * Horizontal rule
 */
export function hr(options = {}) {
  return divider('─', { widthRatio: 0.8, ...options });
}

export default {
  box,
  resultBox,
  infoBox,
  warningBox,
  errorBox,
  successBox,
  divider,
  hr,
  BOX_STYLES,
};
