/**
 * Elegant Spinner Component
 *
 * A beautiful, customizable spinner with multiple states and styles.
 * Supports smooth transitions between states.
 */

import logUpdate from 'log-update';
import cliCursor from 'cli-cursor';
import { style, symbols, gradients, spacing, ansi } from './theme.js';

// Spinner frame sets
const FRAMES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  circle: ['◐', '◓', '◑', '◒'],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  pulse: ['█', '▓', '▒', '░', '▒', '▓'],
  grow: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
};

const DEFAULT_INTERVAL = 80;

/**
 * Create a new elegant spinner
 */
export function createSpinner(options = {}) {
  const {
    text = '',
    frames = FRAMES.dots,
    interval = DEFAULT_INTERVAL,
    color = 'accent',
    indent = true,
  } = options;

  let currentText = text;
  let frameIndex = 0;
  let timer = null;
  let isSpinning = false;
  let currentState = 'idle';

  const prefix = indent ? spacing.indent : '';

  // Get styled frame based on state
  const getStyledFrame = (frame) => {
    switch (currentState) {
      case 'success':
        return style.success(symbols.success);
      case 'error':
        return style.error(symbols.error);
      case 'warning':
        return style.warning(symbols.warning);
      case 'info':
        return style.info(symbols.info);
      default:
        return style[color] ? style[color](frame) : style.accent(frame);
    }
  };

  // Render current frame
  const render = () => {
    const frame = frames[frameIndex];
    const styledFrame = getStyledFrame(frame);
    const output = `${prefix}${styledFrame} ${currentText}`;
    logUpdate(output);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  // API
  const spinner = {
    start(initialText) {
      if (isSpinning) return spinner;
      if (initialText) currentText = initialText;
      currentState = 'spinning';
      isSpinning = true;
      cliCursor.hide();
      render();
      timer = setInterval(render, interval);
      return spinner;
    },

    stop() {
      if (!isSpinning) return spinner;
      clearInterval(timer);
      timer = null;
      isSpinning = false;
      cliCursor.show();
      logUpdate.clear();
      return spinner;
    },

    update(newText) {
      currentText = newText;
      if (!isSpinning) render();
      return spinner;
    },

    success(text) {
      currentState = 'success';
      currentText = text || currentText;
      spinner.stop();
      const output = `${prefix}${style.success(symbols.success)} ${style.primary(currentText)}`;
      logUpdate(output);
      logUpdate.done();
      return spinner;
    },

    error(text) {
      currentState = 'error';
      currentText = text || currentText;
      spinner.stop();
      const output = `${prefix}${style.error(symbols.error)} ${style.primary(currentText)}`;
      logUpdate(output);
      logUpdate.done();
      return spinner;
    },

    warning(text) {
      currentState = 'warning';
      currentText = text || currentText;
      spinner.stop();
      const output = `${prefix}${style.warning(symbols.warning)} ${style.primary(currentText)}`;
      logUpdate(output);
      logUpdate.done();
      return spinner;
    },

    info(text) {
      currentState = 'info';
      currentText = text || currentText;
      spinner.stop();
      const output = `${prefix}${style.info(symbols.info)} ${style.primary(currentText)}`;
      logUpdate(output);
      logUpdate.done();
      return spinner;
    },

    // Clear without final message
    clear() {
      spinner.stop();
      logUpdate.clear();
      return spinner;
    },

    // Get current state
    get isActive() {
      return isSpinning;
    },

    get text() {
      return currentText;
    },
  };

  return spinner;
}

/**
 * Create a multi-step spinner that shows progress through stages
 */
export function createStepSpinner(steps, options = {}) {
  const { color = 'accent' } = options;
  const spinner = createSpinner({ ...options, color });
  let currentStep = 0;

  const formatStep = (index, total, text) => {
    const stepIndicator = style.muted(`[${index + 1}/${total}]`);
    return `${stepIndicator} ${text}`;
  };

  return {
    start() {
      const step = steps[currentStep];
      spinner.start(formatStep(currentStep, steps.length, step));
      return this;
    },

    next() {
      currentStep++;
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        spinner.update(formatStep(currentStep, steps.length, step));
      }
      return this;
    },

    update(text) {
      spinner.update(formatStep(currentStep, steps.length, text));
      return this;
    },

    success(text) {
      spinner.success(text || steps[currentStep]);
      return this;
    },

    error(text) {
      spinner.error(text || steps[currentStep]);
      return this;
    },

    complete(text) {
      spinner.success(text || 'Complete');
      return this;
    },

    get currentStep() {
      return currentStep;
    },

    get totalSteps() {
      return steps.length;
    },
  };
}

/**
 * Create a thinking spinner with gradient animation
 */
export function createThinkingSpinner(text = 'Thinking') {
  const frames = FRAMES.dots;
  const words = ['Analyzing', 'Processing', 'Reasoning', 'Thinking'];
  let wordIndex = 0;
  let frameIndex = 0;
  let timer = null;
  let wordTimer = null;
  let currentWord = text;
  let dotCount = 0;

  const render = () => {
    const frame = style.thinking(frames[frameIndex]);
    const dots = '.'.repeat(dotCount % 4);
    const paddedDots = dots.padEnd(3, ' ');
    const text = gradients.thinking(`${currentWord}${paddedDots}`);
    logUpdate(`${spacing.indent}${frame} ${text}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  return {
    start() {
      cliCursor.hide();
      render();
      timer = setInterval(() => {
        frameIndex = (frameIndex + 1) % frames.length;
        render();
      }, 80);
      wordTimer = setInterval(() => {
        dotCount++;
        render();
      }, 400);
      return this;
    },

    stop() {
      clearInterval(timer);
      clearInterval(wordTimer);
      cliCursor.show();
      logUpdate.clear();
      return this;
    },

    success(message) {
      this.stop();
      logUpdate(`${spacing.indent}${style.success(symbols.success)} ${message || ''}`);
      logUpdate.done();
      return this;
    },
  };
}

// Export frame sets for custom spinners
export { FRAMES };

// Default export: simple spinner creation
export default createSpinner;
