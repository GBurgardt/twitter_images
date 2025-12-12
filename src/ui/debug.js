import * as clack from '@clack/prompts';

const VERBOSE = { enabled: false };

export function setVerbose(enabled) {
  VERBOSE.enabled = Boolean(enabled);
}

export function debug(...args) {
  if (VERBOSE.enabled) {
    console.log('[debug]', ...args);
  }
}

export function spinner(message = 'Procesando...') {
  const s = clack.spinner();
  s.start(message);
  return {
    update: (msg) => s.message(msg),
    success: (msg) => s.stop(msg || message),
    error: (msg) => s.stop(msg || 'Error'),
    stop: () => s.stop()
  };
}

export function isVerbose() {
  return VERBOSE.enabled;
}

export { clack };

