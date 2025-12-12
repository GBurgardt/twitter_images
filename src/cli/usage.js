/**
 * Usage & Help Display
 *
 * "Here's the new application. It's got one window.
 * You drag your video into the window.
 * Then you click the button that says BURN.
 * That's it." — Steve Jobs
 *
 * The help screen should be:
 * - Immediately understandable
 * - Visually calm
 * - Focused on the ONE thing the user needs
 */

import { style, spacing, brandHeader } from '../ui/theme.js';

/**
 * Show minimal, elegant help screen
 */
export function showUsage() {
  const s = spacing.indent;
  const dim = style.secondary;
  const accent = style.accent;
  const primary = style.primary;

  // The logo - creates immediate visual impact
  console.log(brandHeader());

  // The tagline - one line, evocative
  const termWidth = process.stdout.columns || 80;
  const tagline = 'Paste a URL. Get the insight.';
  const tagPad = ' '.repeat(Math.max(0, Math.floor((termWidth - tagline.length) / 2)));
  console.log(`${tagPad}${dim(tagline)}`);

  // Generous breathing room
  console.log('');
  console.log('');

  // The essentials - only 3 commands
  console.log(`${s}${s}${accent('twx')}                    ${dim('Browse your library')}`);
  console.log(`${s}${s}${accent('twx <url>')}              ${dim('Analyze any content')}`);
  console.log(`${s}${s}${accent('twx config')}             ${dim('Setup API keys')}`);

  // Breathing room
  console.log('');
  console.log('');

  // Navigation hint - minimal
  const hint = '↑↓ Navigate    Enter Select    Ctrl+C Exit';
  const hintPad = ' '.repeat(Math.max(0, Math.floor((termWidth - hint.length) / 2)));
  console.log(`${hintPad}${dim(hint)}`);

  // Final breathing room
  console.log('');
  console.log('');
}

/**
 * Show verbose help with all options
 * For users who explicitly want more
 */
export function showVerboseUsage() {
  const s = spacing.indent;
  const dim = style.secondary;
  const accent = style.accent;

  // Start with the minimal version
  showUsage();

  // Then add the details
  console.log(`${s}${style.primary('More Commands')}`);
  console.log('');

  const commands = [
    ['twx <url> "directive"', 'Add instructions for the AI'],
    ['twx <url> --thread', 'Extract full Twitter thread'],
    ['twx <url> transcript', 'Get raw transcript only'],
    ['twx list', 'Show recent history'],
    ['twx setmodel <model>', 'Switch AI provider'],
  ];

  for (const [cmd, desc] of commands) {
    console.log(`${s}${s}${accent(cmd.padEnd(24))}${dim(desc)}`);
  }

  console.log('');
  console.log(`${s}${style.primary('Models')}`);
  console.log('');
  console.log(`${s}${s}${accent('gpt-5.2')}               ${dim('OpenAI (default)')}`);
  console.log(`${s}${s}${accent('opus')}                  ${dim('Claude Opus 4.5')}`);
  console.log(`${s}${s}${accent('gemini')}                ${dim('Gemini Pro')}`);

  console.log('');
  console.log(`${s}${style.primary('Options')}`);
  console.log('');
  console.log(`${s}${s}${accent('--clip 0:30-2:00')}      ${dim('Video segment')}`);
  console.log(`${s}${s}${accent('--model <id>')}          ${dim('One-off model')}`);
  console.log(`${s}${s}${accent('--verbose')}             ${dim('Debug info')}`);

  console.log('');
}

export default { showUsage, showVerboseUsage };
