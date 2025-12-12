/**
 * Miscellaneous UI Components
 *
 * Welcome, goodbye, confirmations, and utility functions.
 */

import * as clack from '@clack/prompts';
import { style, symbols, spacing, gradients, brandHeader } from './theme.js';

/**
 * Show elegant welcome header
 */
export function showWelcome() {
  console.log(brandHeader());
}

/**
 * Show goodbye message
 */
export function showGoodbye(message = 'See you next time') {
  console.log('');
  console.log(`${spacing.indent}${style.muted(message)}`);
  console.log('');
}

/**
 * Show a styled intro (alternative to clack.intro)
 */
export function intro(title) {
  console.log('');
  console.log(`${spacing.indent}${gradients.brand(title)}`);
  console.log(`${spacing.indent}${style.dim('─'.repeat(title.length + 4))}`);
}

/**
 * Show a styled outro (alternative to clack.outro)
 */
export function outro(message) {
  console.log('');
  console.log(`${spacing.indent}${style.success(symbols.success)} ${message}`);
  console.log('');
}

/**
 * Confirmation prompt
 */
export async function confirm(message, defaultValue = true) {
  const result = await clack.confirm({
    message,
    initialValue: defaultValue,
  });

  if (clack.isCancel(result)) return false;
  return result;
}

/**
 * Text input prompt
 */
export async function textInput(message, options = {}) {
  const { placeholder = '', defaultValue = '' } = options;

  const result = await clack.text({
    message,
    placeholder,
    defaultValue,
  });

  if (clack.isCancel(result)) return null;
  return result;
}

/**
 * Select prompt
 */
export async function select(message, options) {
  const result = await clack.select({
    message,
    options,
  });

  if (clack.isCancel(result)) return null;
  return result;
}

/**
 * Check if running in interactive mode (TTY)
 */
export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Get terminal dimensions
 */
export function getTerminalSize() {
  return {
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  };
}

/**
 * Clear the screen
 */
export function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

/**
 * Clear current line
 */
export function clearLine() {
  process.stdout.write('\x1b[2K\r');
}

/**
 * Move cursor up n lines
 */
export function cursorUp(n = 1) {
  process.stdout.write(`\x1b[${n}A`);
}

/**
 * Move cursor down n lines
 */
export function cursorDown(n = 1) {
  process.stdout.write(`\x1b[${n}B`);
}

/**
 * Hide cursor
 */
export function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

/**
 * Show cursor
 */
export function showCursor() {
  process.stdout.write('\x1b[?25h');
}

/**
 * Check if cancelled (utility for clack)
 */
export function isCancel(value) {
  return clack.isCancel(value);
}

export default {
  showWelcome,
  showGoodbye,
  intro,
  outro,
  confirm,
  textInput,
  select,
  isInteractive,
  getTerminalSize,
  clearScreen,
  clearLine,
  cursorUp,
  cursorDown,
  hideCursor,
  showCursor,
  isCancel,
};
