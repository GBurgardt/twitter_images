/**
 * Debug & Spinner Module
 *
 * Provides elegant logging and spinner functionality.
 */

import * as clackModule from '@clack/prompts';
import { createSpinner } from './spinner.js';
import { style, symbols, spacing } from './theme.js';

// Re-export clack for backward compatibility
export const clack = clackModule;

// Verbose mode state
const VERBOSE = { enabled: false };

/**
 * Enable/disable verbose mode
 */
export function setVerbose(enabled) {
  VERBOSE.enabled = Boolean(enabled);
}

/**
 * Check if verbose mode is enabled
 */
export function isVerbose() {
  return VERBOSE.enabled;
}

/**
 * Debug log (only in verbose mode)
 */
export function debug(...args) {
  if (VERBOSE.enabled) {
    const prefix = style.muted('[debug]');
    console.log(prefix, ...args);
  }
}

/**
 * Create an elegant spinner
 */
export function spinner(message = 'Processing...') {
  const s = createSpinner({ text: message });
  s.start();

  return {
    update: (msg) => {
      s.update(msg);
    },
    success: (msg) => {
      if (msg) {
        s.success(msg);
      } else {
        s.clear();
      }
    },
    error: (msg) => {
      s.error(msg || 'Error');
    },
    warning: (msg) => {
      s.warning(msg);
    },
    info: (msg) => {
      s.info(msg);
    },
    stop: () => {
      s.clear();
    },
  };
}

/**
 * Log functions with elegant styling
 * Simplified to match our 5-color palette
 */
export const log = {
  info: (message) => {
    console.log(`${spacing.indent}${style.accent(symbols.pointer)} ${message}`);
  },

  success: (message) => {
    console.log(`${spacing.indent}${style.success(symbols.success)} ${message}`);
  },

  warning: (message) => {
    console.log(`${spacing.indent}${style.accent(symbols.pointer)} ${message}`);
  },

  error: (message) => {
    console.log(`${spacing.indent}${style.error(symbols.error)} ${message}`);
  },

  message: (message) => {
    console.log(`${spacing.indent}${message}`);
  },

  step: (message) => {
    console.log(`${spacing.indent}${style.accent(symbols.pointer)} ${message}`);
  },

  muted: (message) => {
    console.log(`${spacing.indent}${style.secondary(message)}`);
  },
};

export default {
  setVerbose,
  isVerbose,
  debug,
  spinner,
  log,
  clack,
};
