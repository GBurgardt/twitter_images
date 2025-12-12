/**
 * Streaming Box - Bulletproof Edition
 *
 * REGLAS INVIOLABLES:
 * 1. NUNCA cortar palabras a mitad
 * 2. Bordes SIEMPRE alineados
 * 3. Ancho consistente en TODAS las líneas
 * 4. Word-wrap por PALABRA, no por carácter
 */

import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { style, symbols, ansi, rgb } from '../ui/theme.js';

// Box characters - single source of truth
const BOX = {
  tl: '╭', tr: '╮',
  bl: '╰', br: '╯',
  h: '─', v: '│',
  dl: '├', dr: '┤',
};

/**
 * Create a bulletproof streaming box
 *
 * Architecture:
 * ╭──────────────────────────────────────╮  <- top border (boxWidth chars between corners)
 * │ TITLE                         model │  <- header line
 * ├──────────────────────────────────────┤  <- divider
 * │                                      │  <- padding line
 * │ Content goes here and wraps         │  <- content lines
 * │ properly at word boundaries.        │
 * │                                      │  <- padding line
 * ╰──────────────────────────────────────╯  <- bottom border
 *
 * Width math:
 * - boxWidth = total chars between vertical borders (excluding the │ chars themselves)
 * - contentWidth = boxWidth - 2 (for the space padding on each side)
 */
export function createBoxedStreamer(stdout, opts = {}) {
  const cols = stdout?.columns || 80;
  const widthRatio = opts.widthRatio || 0.65;

  // Calculate dimensions - SINGLE SOURCE OF TRUTH
  const boxWidth = Math.max(50, Math.min(100, Math.floor(cols * widthRatio)));
  const contentWidth = boxWidth - 2; // space on each side of content

  // Centering
  const marginSize = Math.max(0, Math.floor((cols - boxWidth - 2) / 2));
  const margin = ' '.repeat(marginSize);

  // Colors
  const borderColor = ansi.fg(...(rgb.boxBorder || [55, 65, 81]));
  const textColor = ansi.fg(...(rgb.boxText || [229, 231, 235]));
  const reset = ansi.reset;

  // State
  let wordBuffer = '';      // Accumulate chars until whitespace
  let lineBuffer = '';      // Current line content
  let lineWidth = 0;        // Visual width of current line
  let isOpen = false;       // Is a line currently open?

  // Title/model
  const rawTitle = opts.rawTitle || 'RESPONSE';
  const model = opts.model || '';

  // Helper: write a bordered line with exact padding
  const writeBorderedLine = (content, contentVisualWidth) => {
    const padding = Math.max(0, contentWidth - contentVisualWidth);
    stdout.write(`${margin}${borderColor}${BOX.v}${reset} ${content}${' '.repeat(padding)} ${borderColor}${BOX.v}${reset}\n`);
  };

  // Helper: write horizontal border
  const writeHorizontal = (left, right) => {
    stdout.write(`${margin}${borderColor}${left}${BOX.h.repeat(boxWidth)}${right}${reset}\n`);
  };

  // Write top section
  const writeTop = () => {
    stdout.write('\n');

    // Top border
    writeHorizontal(BOX.tl, BOX.tr);

    // Header: TITLE                    model
    const titleStyled = style.primary(rawTitle);
    const modelStyled = model ? style.secondary(model) : '';
    const titleWidth = stringWidth(rawTitle);
    const modelWidth = model ? stringWidth(model) : 0;
    const spaceBetween = Math.max(1, contentWidth - titleWidth - modelWidth);

    const headerContent = `${titleStyled}${' '.repeat(spaceBetween)}${modelStyled}`;
    writeBorderedLine(headerContent, titleWidth + spaceBetween + modelWidth);

    // Divider
    writeHorizontal(BOX.dl, BOX.dr);

    // Padding line
    writeBorderedLine('', 0);

    isOpen = false;
    lineBuffer = '';
    lineWidth = 0;
    wordBuffer = '';
  };

  // Flush word buffer to line buffer
  const flushWord = () => {
    if (!wordBuffer) return;

    const wordWidth = stringWidth(wordBuffer);

    // If word doesn't fit on current line, wrap first
    if (lineWidth > 0 && lineWidth + wordWidth > contentWidth) {
      // Write current line and start new one
      writeBorderedLine(textColor + lineBuffer + reset, lineWidth);
      lineBuffer = '';
      lineWidth = 0;
    }

    // If single word is longer than content width, force break it
    if (wordWidth > contentWidth) {
      // Use wrap-ansi to properly break long words
      const wrapped = wrapAnsi(wordBuffer, contentWidth, { hard: true, trim: false });
      const lines = wrapped.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const lineW = stringWidth(lines[i]);
        if (lineWidth > 0) {
          writeBorderedLine(textColor + lineBuffer + reset, lineWidth);
          lineBuffer = '';
          lineWidth = 0;
        }
        writeBorderedLine(textColor + lines[i] + reset, lineW);
      }
      // Last part goes to buffer
      wordBuffer = lines[lines.length - 1];
      const lastWidth = stringWidth(wordBuffer);
      lineBuffer += wordBuffer;
      lineWidth += lastWidth;
      wordBuffer = '';
      return;
    }

    // Add word to line buffer
    lineBuffer += wordBuffer;
    lineWidth += wordWidth;
    wordBuffer = '';
  };

  // Handle a single character (called during streaming)
  const writeChar = (char) => {
    if (!char) return;

    // Newline = flush everything and write line
    if (char === '\n') {
      flushWord();
      if (lineBuffer || lineWidth === 0) {
        writeBorderedLine(textColor + lineBuffer + reset, lineWidth);
      }
      lineBuffer = '';
      lineWidth = 0;
      return;
    }

    // Whitespace = flush word, then add space to line
    if (/\s/.test(char)) {
      flushWord();
      // Only add space if we have content and room
      if (lineWidth > 0 && lineWidth < contentWidth) {
        lineBuffer += char;
        lineWidth += 1;
      }
      return;
    }

    // Regular character = add to word buffer
    wordBuffer += char;
  };

  // Write a complete token (word or whitespace chunk)
  const writeToken = (token) => {
    if (!token) return;

    for (const char of token) {
      writeChar(char);
    }
  };

  // Write bottom section
  const writeBottom = (meta = null) => {
    // Flush any remaining content
    flushWord();
    if (lineBuffer) {
      writeBorderedLine(textColor + lineBuffer + reset, lineWidth);
      lineBuffer = '';
      lineWidth = 0;
    }

    // Padding line
    writeBorderedLine('', 0);

    // Optional footer
    if (meta) {
      writeHorizontal(BOX.dl, BOX.dr);
      const metaContent = `${style.success(symbols.success)} ${style.secondary(meta)}`;
      const metaWidth = stringWidth(meta) + 2;
      writeBorderedLine(metaContent, metaWidth);
    }

    // Bottom border
    writeHorizontal(BOX.bl, BOX.br);
    stdout.write('\n');
  };

  return {
    start: writeTop,
    writeToken,
    writeChar,
    end: writeBottom,

    // Write a complete line (non-streamed)
    writeLine: (text) => {
      const wrapped = wrapAnsi(text, contentWidth, { hard: true, trim: false });
      for (const line of wrapped.split('\n')) {
        writeBorderedLine(textColor + line + reset, stringWidth(line));
      }
    },

    get width() { return contentWidth; },
    get boxWidth() { return boxWidth; },
  };
}

/**
 * Smooth writer - buffers streaming for pleasant display
 * Now properly handles word boundaries
 */
export function createSmoothWriter(writer, opts = {}) {
  const { delayMs = 0 } = opts;
  let pending = Promise.resolve();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const enqueue = (chunk) => {
    if (!chunk) return pending;

    pending = pending.then(async () => {
      // Process character by character, letting writeChar handle word buffering
      for (const char of chunk) {
        writer.writeChar(char);
        if (delayMs > 0) await sleep(delayMs);
      }
    });

    return pending;
  };

  const flush = () => pending;

  return { enqueue, flush };
}

export default {
  createBoxedStreamer,
  createSmoothWriter,
};
