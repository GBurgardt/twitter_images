/**
 * Output Module
 *
 * Elegant output rendering for results, context, and metadata.
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import { style, symbols, spacing, ansi, rgb, gradients, truncate } from './theme.js';
import { resultBox, box } from './boxes.js';
import { isVerbose } from './debug.js';

// Configure marked for terminal
marked.use(
  markedTerminal({
    reflowText: true,
    width: 72,
  })
);

/**
 * Show a result in an elegant box
 */
export function showResult(text, options = {}) {
  if (!text?.trim()) return;

  const { title = null, model = null, showBox = true } = options;

  if (showBox) {
    // Use the elegant result box
    const termWidth = process.stdout.columns || 80;
    const boxWidth = Math.min(termWidth - 4, Math.floor(termWidth * 0.7));
    const contentWidth = boxWidth - 6;

    // Render markdown
    const rendered = marked.parse(text).trim();

    // Wrap content
    const wrapped = wrapAnsi(rendered, contentWidth, { hard: true, trim: false });

    console.log(resultBox(wrapped, {
      title: title ? title.toUpperCase() : 'ANALYSIS',
      model: model || '',
      widthRatio: 0.7,
    }));
  } else {
    // Simple output without box
    console.log('');
    const rendered = marked.parse(text).trim();
    console.log(rendered);
    console.log('');
  }
}

/**
 * Show raw text result (no markdown, no box)
 */
export function showRawResult(text, options = {}) {
  const { label = 'Transcription' } = options;

  console.log('');
  console.log(`${spacing.indent}${style.info(symbols.info)} ${style.secondary(label)}`);
  console.log('');

  // Indent the text
  const lines = text.split('\n');
  for (const line of lines) {
    console.log(`${spacing.indent}${spacing.indent}${line}`);
  }

  console.log('');
}

/**
 * Show a meta line (small, muted information)
 */
export function showMetaLine(text) {
  if (!text) return;
  console.log(`${spacing.indent}${style.muted(text)}`);
}

/**
 * Show progress for multi-item operations
 */
export function showProgress(current, total, item) {
  if (!isVerbose()) return;

  const progress = style.muted(`[${current}/${total}]`);
  const itemText = style.secondary(truncate(item, 50));
  console.log(`${spacing.indent}${spacing.indent}${progress} ${itemText}`);
}

/**
 * Show detected context (verbose mode only)
 */
export function showContext(context) {
  if (!isVerbose() || !context) return;

  console.log('');
  console.log(`${spacing.indent}${style.info(symbols.info)} ${style.secondary('Detected context:')}`);

  const lines = context.split('\n').slice(0, 5);
  for (const line of lines) {
    console.log(`${spacing.indent}${spacing.indent}${style.muted(truncate(line, 65))}`);
  }

  if (context.split('\n').length > 5) {
    console.log(`${spacing.indent}${spacing.indent}${style.dim('...')}`);
  }
}

/**
 * Show a section header
 */
export function showSection(title, icon = null) {
  const iconStr = icon ? `${icon} ` : '';
  console.log('');
  console.log(`${spacing.indent}${iconStr}${style.header(title)}`);
  console.log(`${spacing.indent}${style.dim('─'.repeat(title.length * 2 + 4))}`);
}

/**
 * Show a key-value pair
 */
export function showKeyValue(key, value, options = {}) {
  const { indent = true } = options;
  const prefix = indent ? spacing.indent : '';
  console.log(`${prefix}${style.muted(key + ':')} ${style.primary(value)}`);
}

/**
 * Show a list of items
 */
export function showList(items, options = {}) {
  const { numbered = false, indent = true } = options;
  const prefix = indent ? spacing.indent : '';

  items.forEach((item, index) => {
    const bullet = numbered
      ? style.muted(`${index + 1}.`)
      : style.accent(symbols.bullet);
    console.log(`${prefix}${bullet} ${item}`);
  });
}

/**
 * Show a tip or hint
 */
export function showTip(message) {
  console.log(`${spacing.indent}${style.info(symbols.info)} ${style.secondary('Tip:')} ${message}`);
}

/**
 * Show a divider
 */
export function showDivider(width = 40) {
  console.log(`${spacing.indent}${style.dim('─'.repeat(width))}`);
}

/**
 * Show empty line
 */
export function blank() {
  console.log('');
}

export default {
  showResult,
  showRawResult,
  showMetaLine,
  showProgress,
  showContext,
  showSection,
  showKeyValue,
  showList,
  showTip,
  showDivider,
  blank,
};
