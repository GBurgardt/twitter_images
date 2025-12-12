/**
 * Elegant Progress Components
 *
 * Beautiful progress bars and step indicators for long operations.
 */

import logUpdate from 'log-update';
import { style, symbols, spacing, ansi, gradients } from './theme.js';

// Progress bar characters
const BAR_CHARS = {
  filled: '█',
  empty: '░',
  filledSmooth: '▓',
  emptySmooth: '▒',
  gradient: ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'],
};

/**
 * Create a progress bar
 */
export function createProgressBar(options = {}) {
  const {
    total = 100,
    width = 30,
    showPercentage = true,
    showValue = false,
    showEta = false,
    style: barStyle = 'default', // 'default', 'gradient', 'minimal'
  } = options;

  let current = 0;
  let startTime = null;
  let label = '';

  const calculateEta = () => {
    if (!startTime || current === 0) return null;
    const elapsed = Date.now() - startTime;
    const rate = current / elapsed;
    const remaining = (total - current) / rate;
    if (remaining < 1000) return '<1s';
    if (remaining < 60000) return `${Math.ceil(remaining / 1000)}s`;
    return `${Math.ceil(remaining / 60000)}m`;
  };

  const render = () => {
    const ratio = Math.min(1, current / total);
    const filled = Math.round(width * ratio);
    const empty = width - filled;

    let bar;
    switch (barStyle) {
      case 'gradient':
        bar = gradients.brand(BAR_CHARS.filled.repeat(filled)) + style.dim(BAR_CHARS.empty.repeat(empty));
        break;
      case 'minimal':
        bar = style.accent('━'.repeat(filled)) + style.dim('─'.repeat(empty));
        break;
      default:
        bar = style.accent(BAR_CHARS.filled.repeat(filled)) + style.dim(BAR_CHARS.empty.repeat(empty));
    }

    const parts = [spacing.indent, bar];

    if (showPercentage) {
      const percent = `${Math.round(ratio * 100)}%`.padStart(4);
      parts.push(' ', style.secondary(percent));
    }

    if (showValue) {
      const value = `${current}/${total}`;
      parts.push(' ', style.muted(value));
    }

    if (showEta && current < total) {
      const eta = calculateEta();
      if (eta) parts.push(' ', style.muted(`ETA: ${eta}`));
    }

    if (label) {
      parts.push(' ', style.muted(symbols.middot), ' ', style.secondary(label));
    }

    logUpdate(parts.join(''));
  };

  return {
    start() {
      startTime = Date.now();
      render();
      return this;
    },

    update(value, newLabel = null) {
      current = Math.min(total, Math.max(0, value));
      if (newLabel !== null) label = newLabel;
      render();
      return this;
    },

    increment(amount = 1) {
      current = Math.min(total, current + amount);
      render();
      return this;
    },

    setLabel(newLabel) {
      label = newLabel;
      render();
      return this;
    },

    complete(message) {
      current = total;
      render();
      logUpdate.done();
      if (message) {
        console.log(`${spacing.indent}${style.success(symbols.success)} ${message}`);
      }
      return this;
    },

    clear() {
      logUpdate.clear();
      return this;
    },

    get progress() {
      return current / total;
    },
  };
}

/**
 * Create a download progress bar with speed indication
 */
export function createDownloadProgress(options = {}) {
  const { showSpeed = true, showSize = true, width = 25 } = options;

  let totalBytes = 0;
  let downloadedBytes = 0;
  let lastUpdate = Date.now();
  let lastBytes = 0;
  let speed = 0;

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatSpeed = (bytesPerSecond) => {
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  const render = () => {
    // Calculate progress
    const ratio = totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0;
    const filled = Math.round(width * ratio);
    const empty = width - filled;

    const bar = style.accent(BAR_CHARS.filled.repeat(filled)) + style.dim(BAR_CHARS.empty.repeat(empty));

    const parts = [spacing.indent, bar];

    // Percentage
    const percent = `${Math.round(ratio * 100)}%`.padStart(4);
    parts.push(' ', style.secondary(percent));

    // Speed
    if (showSpeed && speed > 0) {
      parts.push(' ', style.muted(symbols.middot), ' ', style.accent(formatSpeed(speed)));
    }

    // Size
    if (showSize && totalBytes > 0) {
      const sizeText = `${formatBytes(downloadedBytes)}/${formatBytes(totalBytes)}`;
      parts.push(' ', style.muted(sizeText));
    }

    logUpdate(parts.join(''));
  };

  return {
    start(total = 0) {
      totalBytes = total;
      downloadedBytes = 0;
      lastUpdate = Date.now();
      lastBytes = 0;
      render();
      return this;
    },

    update(downloaded, total = null) {
      if (total !== null) totalBytes = total;
      downloadedBytes = downloaded;

      // Calculate speed
      const now = Date.now();
      const timeDiff = now - lastUpdate;
      if (timeDiff >= 500) {
        const bytesDiff = downloadedBytes - lastBytes;
        speed = (bytesDiff / timeDiff) * 1000;
        lastUpdate = now;
        lastBytes = downloadedBytes;
      }

      render();
      return this;
    },

    complete(message) {
      downloadedBytes = totalBytes;
      speed = 0;
      render();
      logUpdate.done();
      if (message) {
        console.log(`${spacing.indent}${style.success(symbols.success)} ${message}`);
      }
      return this;
    },

    error(message) {
      logUpdate.done();
      console.log(`${spacing.indent}${style.error(symbols.error)} ${message}`);
      return this;
    },

    clear() {
      logUpdate.clear();
      return this;
    },
  };
}

/**
 * Create a step progress indicator
 */
export function createStepProgress(steps) {
  let currentStep = 0;
  const completedSteps = new Set();
  const failedSteps = new Set();

  const render = () => {
    const lines = [];

    steps.forEach((step, index) => {
      let icon;
      let textStyle;

      if (failedSteps.has(index)) {
        icon = style.error(symbols.error);
        textStyle = style.error;
      } else if (completedSteps.has(index)) {
        icon = style.success(symbols.success);
        textStyle = style.muted;
      } else if (index === currentStep) {
        icon = style.accent(symbols.circleFilled);
        textStyle = style.primary;
      } else {
        icon = style.dim(symbols.circle);
        textStyle = style.dim;
      }

      // Add connector line for non-last items
      const connector = index < steps.length - 1 ? style.dim('│') : ' ';
      const stepText = typeof step === 'string' ? step : step.label;

      lines.push(`${spacing.indent}${icon} ${textStyle(stepText)}`);
      if (index < steps.length - 1) {
        lines.push(`${spacing.indent}${connector}`);
      }
    });

    logUpdate(lines.join('\n'));
  };

  return {
    start() {
      render();
      return this;
    },

    next() {
      completedSteps.add(currentStep);
      currentStep++;
      render();
      return this;
    },

    complete(index = null) {
      if (index !== null) {
        completedSteps.add(index);
      } else {
        completedSteps.add(currentStep);
      }
      render();
      return this;
    },

    fail(index = null) {
      if (index !== null) {
        failedSteps.add(index);
      } else {
        failedSteps.add(currentStep);
      }
      render();
      return this;
    },

    finish() {
      steps.forEach((_, index) => completedSteps.add(index));
      render();
      logUpdate.done();
      return this;
    },

    clear() {
      logUpdate.clear();
      return this;
    },

    get current() {
      return currentStep;
    },

    get total() {
      return steps.length;
    },
  };
}

/**
 * Simple inline progress (for use in other outputs)
 */
export function inlineProgress(current, total, options = {}) {
  const { width = 15, showPercent = true } = options;
  const ratio = Math.min(1, current / total);
  const filled = Math.round(width * ratio);
  const empty = width - filled;

  const bar = style.accent(BAR_CHARS.filled.repeat(filled)) + style.dim(BAR_CHARS.empty.repeat(empty));
  const percent = showPercent ? ` ${Math.round(ratio * 100)}%` : '';

  return `${bar}${style.secondary(percent)}`;
}

export default {
  createProgressBar,
  createDownloadProgress,
  createStepProgress,
  inlineProgress,
};
