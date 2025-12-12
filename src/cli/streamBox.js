/**
 * Elegant Streaming Box
 *
 * A beautiful box component for streaming AI responses.
 * Features smooth character-by-character rendering with
 * proper word wrapping and elegant borders.
 */

import stringWidth from 'string-width';
import { style, symbols, ansi, rgb, spacing, gradients } from '../ui/theme.js';

// Box characters
const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  divider: '├',
  dividerEnd: '┤',
};

/**
 * Create an elegant boxed streamer for AI output
 */
export function createBoxedStreamer(stdout, opts = {}) {
  const cols = stdout?.columns || 80;
  const widthRatio = opts.widthRatio || 0.65;
  const innerWidth = Math.max(50, Math.min(100, Math.floor(cols * widthRatio)));
  const contentWidth = innerWidth - 4; // borders + padding

  // Calculate centering margin
  const marginSize = Math.max(0, Math.floor((cols - innerWidth - 2) / 2));
  const margin = ' '.repeat(marginSize);

  // Colors
  const borderColorArr = opts.borderColor || rgb.boxBorder;
  const textColorArr = opts.textColor || rgb.boxText;
  const headerColorArr = opts.headerColor || rgb.accent;

  // ANSI codes
  const borderAnsi = ansi.fg(...borderColorArr);
  const textAnsi = ansi.fg(...textColorArr);
  const headerAnsi = ansi.fg(...headerColorArr);
  const mutedAnsi = ansi.fg(...rgb.muted);
  const reset = ansi.reset;

  // State
  let lineLen = 0;
  let lineOpen = false;
  let charBuffer = '';
  let headerWritten = false;

  // Title/model for header
  const title = opts.title || 'A N A L Y S I S';
  const model = opts.model || '';

  // Write the top border with header
  const writeTop = () => {
    stdout.write('\n');

    // Top border
    stdout.write(`${margin}${borderAnsi}${BOX.topLeft}${BOX.horizontal.repeat(innerWidth)}${BOX.topRight}${reset}\n`);

    // Header line with title and model
    const titleStyled = style.header(opts.rawTitle || 'ANALYSIS');
    const modelStyled = model ? style.muted(model) : '';
    const titleWidth = stringWidth(opts.rawTitle || 'ANALYSIS');
    const modelWidth = model ? stringWidth(model) : 0;
    const spaceBetween = innerWidth - 2 - titleWidth - modelWidth;

    stdout.write(`${margin}${borderAnsi}${BOX.vertical}${reset} ${titleStyled}${' '.repeat(Math.max(1, spaceBetween))}${modelStyled} ${borderAnsi}${BOX.vertical}${reset}\n`);

    // Divider after header
    stdout.write(`${margin}${borderAnsi}${BOX.divider}${BOX.horizontal.repeat(innerWidth)}${BOX.dividerEnd}${reset}\n`);

    // Empty line for padding
    stdout.write(`${margin}${borderAnsi}${BOX.vertical}${reset}${' '.repeat(innerWidth)}${borderAnsi}${BOX.vertical}${reset}\n`);

    headerWritten = true;
  };

  // Open a new content line
  const openLine = () => {
    stdout.write(`${margin}${borderAnsi}${BOX.vertical}${reset} ${textAnsi}`);
    lineOpen = true;
    lineLen = 0;
  };

  // Close current line with padding
  const closeLine = () => {
    const pad = Math.max(0, contentWidth - lineLen);
    stdout.write(`${reset}${' '.repeat(pad)} ${borderAnsi}${BOX.vertical}${reset}\n`);
    lineOpen = false;
    lineLen = 0;
  };

  // Write a single token (character or word)
  const writeToken = (token) => {
    if (!token) return;

    // Handle newlines
    if (token === '\n') {
      if (!lineOpen) openLine();
      closeLine();
      return;
    }

    // Handle long tokens by splitting
    if (stringWidth(token) > contentWidth) {
      let remaining = token;
      while (remaining.length > 0) {
        const maxChars = contentWidth - lineLen;
        if (maxChars <= 0) {
          if (lineOpen) closeLine();
          openLine();
          continue;
        }
        const slice = remaining.slice(0, maxChars);
        writeToken(slice);
        remaining = remaining.slice(slice.length);
      }
      return;
    }

    // Open line if needed
    if (!lineOpen) openLine();

    // Wrap to new line if token doesn't fit
    const tokenWidth = stringWidth(token);
    if (lineLen + tokenWidth > contentWidth && lineLen > 0) {
      closeLine();
      openLine();
    }

    // Write the token
    stdout.write(token);
    lineLen += tokenWidth;
  };

  // Write the bottom border
  const writeBottom = (meta = null) => {
    // Close any open line
    if (lineOpen) closeLine();

    // Empty line for padding
    stdout.write(`${margin}${borderAnsi}${BOX.vertical}${reset}${' '.repeat(innerWidth)}${borderAnsi}${BOX.vertical}${reset}\n`);

    // Optional footer with meta info
    if (meta) {
      stdout.write(`${margin}${borderAnsi}${BOX.divider}${BOX.horizontal.repeat(innerWidth)}${BOX.dividerEnd}${reset}\n`);

      const metaText = `${style.success(symbols.success)} ${style.muted(meta)}`;
      const metaWidth = stringWidth(meta) + 2; // icon + space + text
      const metaPad = Math.max(0, innerWidth - 2 - metaWidth);

      stdout.write(`${margin}${borderAnsi}${BOX.vertical}${reset} ${metaText}${' '.repeat(metaPad)} ${borderAnsi}${BOX.vertical}${reset}\n`);
    }

    // Bottom border
    stdout.write(`${margin}${borderAnsi}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth)}${BOX.bottomRight}${reset}\n`);
    stdout.write('\n');
  };

  return {
    start: writeTop,
    writeToken,
    end: (meta) => writeBottom(meta),

    // Direct line writing (for non-streamed content)
    writeLine: (text) => {
      if (!lineOpen) openLine();
      const words = text.split(/(\s+)/);
      for (const word of words) {
        writeToken(word);
      }
      closeLine();
    },

    // Get dimensions
    get width() {
      return contentWidth;
    },
    get innerWidth() {
      return innerWidth;
    },
  };
}

/**
 * Create a smooth writer that buffers and renders tokens with a slight delay
 * for a pleasing streaming effect
 */
export function createSmoothWriter(writer, opts = {}) {
  const { delayMs = 0, chunkSize = 1 } = opts;
  let pending = Promise.resolve();

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  const enqueue = (chunk) => {
    if (!chunk) return pending;

    pending = pending.then(async () => {
      // Split into tokens (words and whitespace)
      const tokens = chunk.match(/(\s+|[^\s]+)/g) || [];

      for (const token of tokens) {
        if (chunkSize === 1) {
          // Character by character
          for (const char of token) {
            writer.writeToken(char);
            if (delayMs > 0) await sleep(delayMs);
          }
        } else {
          // Chunk mode
          writer.writeToken(token);
          if (delayMs > 0) await sleep(delayMs);
        }
      }
    });

    return pending;
  };

  const flush = () => pending;

  return { enqueue, flush };
}

/**
 * Create a thinking indicator that pulses while waiting for response
 */
export function createThinkingIndicator(stdout, opts = {}) {
  const cols = stdout?.columns || 80;
  const widthRatio = opts.widthRatio || 0.65;
  const innerWidth = Math.max(50, Math.min(100, Math.floor(cols * widthRatio)));
  const marginSize = Math.max(0, Math.floor((cols - innerWidth - 2) / 2));
  const margin = ' '.repeat(marginSize);

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let timer = null;
  let dotCount = 0;

  const borderAnsi = ansi.fg(...rgb.boxBorder);
  const reset = ansi.reset;

  const render = () => {
    const frame = style.thinking(frames[frameIndex]);
    const dots = '.'.repeat(dotCount % 4).padEnd(3);
    const text = gradients.thinking(`Analyzing${dots}`);

    // Clear line and write
    stdout.write(`\r${margin}${borderAnsi}${BOX.vertical}${reset} ${frame} ${text}${' '.repeat(innerWidth - 20)}${borderAnsi}${BOX.vertical}${reset}`);

    frameIndex = (frameIndex + 1) % frames.length;
  };

  return {
    start() {
      render();
      timer = setInterval(() => {
        render();
      }, 80);

      // Update dots every 300ms
      setInterval(() => {
        dotCount++;
      }, 300);

      return this;
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Clear the line
      stdout.write(`\r${' '.repeat(cols)}\r`);
      return this;
    },
  };
}

export default {
  createBoxedStreamer,
  createSmoothWriter,
  createThinkingIndicator,
};
