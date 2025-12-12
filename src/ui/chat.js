/**
 * Chat Interface Module
 *
 * Elegant chat prompt with multiline support.
 * Features beautiful prompt styling and input handling.
 */

import readline from 'node:readline/promises';
import { style, symbols, spacing, gradients } from './theme.js';

// Prompt styles
const PROMPT_PRIMARY = style.accent('twx›');
const PROMPT_CONTINUE = style.dim('  ›');
const PROMPT_HINT = style.dim('(empty line to send, "exit" to quit)');

/**
 * Show elegant chat header
 */
export function showChatHeader() {
  console.log('');
  console.log(`${spacing.indent}${style.secondary('What would you like to know?')}`);
  console.log(`${spacing.indent}${PROMPT_HINT}`);
}

/**
 * Elegant chat prompt with multiline support
 */
export async function chatPrompt(options = {}) {
  const { showHeader = false } = options;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  if (showHeader) {
    showChatHeader();
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\n${spacing.indent}${PROMPT_PRIMARY} `,
  });

  return new Promise((resolve) => {
    const lines = [];
    let resolved = false;
    let isFirstLine = true;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(result);
    };

    rl.on('line', (line) => {
      // Empty line on first input = exit
      if (line === '' && lines.length === 0) {
        finish(null);
        return;
      }

      // Empty line after content = submit
      if (line === '' && lines.length > 0) {
        finish(lines.join('\n').trim() || null);
        return;
      }

      // Check for exit commands (only on first line)
      if (lines.length === 0) {
        const cmd = line.toLowerCase().trim();
        if (cmd === 'exit' || cmd === 'quit' || cmd === 'back' || cmd === 'q') {
          finish(line);
          return;
        }
      }

      // Add line to buffer
      lines.push(line);
      isFirstLine = false;

      // Change prompt for continuation
      rl.setPrompt(`${spacing.indent}${PROMPT_CONTINUE} `);
      rl.prompt();
    });

    rl.on('close', () => {
      finish(lines.length > 0 ? lines.join('\n').trim() : null);
    });

    rl.on('SIGINT', () => {
      console.log(''); // Clean line after ^C
      finish(null);
    });

    rl.prompt();
  });
}

/**
 * Simple single-line input with styled prompt
 */
export async function simpleInput(message = '') {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = message
    ? `${spacing.indent}${style.accent(message)} `
    : `${spacing.indent}${PROMPT_PRIMARY} `;

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer?.trim() || null);
    });

    rl.on('SIGINT', () => {
      rl.close();
      resolve(null);
    });
  });
}

/**
 * Show typing indicator while waiting
 */
export function showTypingIndicator() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let timer = null;

  const render = () => {
    const frame = style.thinking(frames[frameIndex]);
    process.stdout.write(`\r${spacing.indent}${frame} ${style.dim('Thinking...')}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  timer = setInterval(render, 80);

  return {
    stop: () => {
      clearInterval(timer);
      process.stdout.write(`\r${' '.repeat(30)}\r`);
    },
  };
}

/**
 * Show a chat message bubble (for displaying history)
 */
export function showChatMessage(role, content, options = {}) {
  const { muted = false } = options;

  console.log('');

  if (role === 'user') {
    const prefix = muted ? style.dim('You:') : style.accent('You:');
    const text = muted ? style.dim(content) : style.secondary(content);
    console.log(`${spacing.indent}${prefix}`);

    // Indent content
    const lines = content.split('\n');
    for (const line of lines) {
      console.log(`${spacing.indent}${spacing.indent}${text}`);
    }
  } else {
    const prefix = muted ? style.dim('twx:') : style.highlight('twx:');
    const text = muted ? style.dim(content) : style.primary(content);
    console.log(`${spacing.indent}${prefix}`);

    // Indent content
    const lines = content.split('\n');
    for (const line of lines) {
      console.log(`${spacing.indent}${spacing.indent}${line}`);
    }
  }
}

/**
 * Show conversation divider
 */
export function showConversationDivider() {
  console.log('');
  console.log(`${spacing.indent}${style.dim('─'.repeat(40))}`);
}

export default {
  chatPrompt,
  showChatHeader,
  simpleInput,
  showTypingIndicator,
  showChatMessage,
  showConversationDivider,
};
