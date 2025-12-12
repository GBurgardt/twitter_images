/**
 * Usage & Help Display
 *
 * Elegant help screen with beautiful formatting.
 */

import { style, symbols, spacing, gradients, brandHeader } from '../ui/theme.js';

/**
 * Show elegant usage/help screen
 */
export function showUsage() {
  const s = spacing.indent;
  const dim = style.dim;
  const accent = style.accent;
  const secondary = style.secondary;
  const muted = style.muted;
  const primary = style.primary;

  console.log(brandHeader());

  // Tagline
  console.log(`${s}${secondary('Paste a URL. Get the insight. Chat with your ideas.')}`);
  console.log('');

  // Usage section
  console.log(`${s}${style.header('USAGE')}`);
  console.log(`${s}${dim('─'.repeat(50))}`);
  console.log('');

  const usageItems = [
    ['twx', 'Open library (browse & chat with saved ideas)'],
    ['twx <url>', 'Analyze: Twitter, YouTube, any URL'],
    ['twx <url> "directive"', 'Add optional directive for the model'],
    ['twx <url> --thread', 'Extract full Twitter thread via API'],
    ['twx <url> transcript', 'Get raw transcript (yt-dlp + Whisper)'],
    ['twx <path>', 'Analyze local files'],
    ['twx list', 'Show history'],
    ['twx config', 'Setup API keys'],
    ['twx setmodel <model>', 'Switch AI provider'],
  ];

  for (const [cmd, desc] of usageItems) {
    console.log(`${s}${s}${accent(cmd.padEnd(24))}${muted(desc)}`);
  }

  console.log('');

  // Library section
  console.log(`${s}${style.header('LIBRARY')}`);
  console.log(`${s}${dim('─'.repeat(50))}`);
  console.log('');
  console.log(`${s}${s}${muted('↑↓')}        ${secondary('Navigate (max 10 shown, favorites first)')}`);
  console.log(`${s}${s}${muted('Enter')}     ${secondary('Open idea & chat')}`);
  console.log(`${s}${s}${muted('/')}         ${secondary('Search (appears with 10+ ideas)')}`);
  console.log(`${s}${s}${muted('Ctrl+C')}    ${secondary('Exit')}`);
  console.log('');
  console.log(`${s}${s}${style.gold(symbols.star)} ${muted('= favorite')}    ${muted('(3)')} ${muted('= messages in conversation')}`);
  console.log('');

  // Chat section
  console.log(`${s}${style.header('CHAT')}`);
  console.log(`${s}${dim('─'.repeat(50))}`);
  console.log('');
  console.log(`${s}${s}${secondary('After analyzing, enter chat mode:')}`);
  console.log(`${s}${s}${muted('1.')} ${secondary('Type your question')}`);
  console.log(`${s}${s}${muted('2.')} ${secondary('Press Enter twice to send')}`);
  console.log(`${s}${s}${muted('3.')} ${secondary('AI responds with full context')}`);
  console.log(`${s}${s}${muted('4.')} ${secondary('Type "exit" or empty line to quit')}`);
  console.log('');

  // Models section
  console.log(`${s}${style.header('MODELS')}`);
  console.log(`${s}${dim('─'.repeat(50))}`);
  console.log('');
  console.log(`${s}${s}${accent('gpt-5.2')}         ${secondary('OpenAI GPT-5.2 (default)')}`);
  console.log(`${s}${s}${accent('gpt-5.2-pro')}     ${secondary('OpenAI GPT-5.2 Pro')}`);
  console.log(`${s}${s}${accent('opus')}            ${secondary('Claude Opus 4.5')}`);
  console.log(`${s}${s}${accent('gemini')}          ${secondary('Gemini Pro')}`);
  console.log('');
  console.log(`${s}${s}${muted('Switch with:')} ${accent('twx setmodel gpt-5.2')}`);
  console.log(`${s}${s}${muted('One-off:')} ${accent('twx <url> --model gemini')}`);
  console.log('');

  // Styles section
  console.log(`${s}${style.header('STYLES')}`);
  console.log(`${s}${dim('─'.repeat(50))}`);
  console.log('');
  console.log(`${s}${s}${accent('bukowski')}        ${secondary('Charles Bukowski voice (default)')}`);
  console.log(`${s}${s}${accent('musk')}            ${secondary('Elon Musk voice (alias: elon, m, mx)')}`);
  console.log('');

  // Options section
  console.log(`${s}${style.header('OPTIONS')}`);
  console.log(`${s}${dim('─'.repeat(50))}`);
  console.log('');
  console.log(`${s}${s}${accent('--clip 0:30-2:00')}    ${secondary('Video segment')}`);
  console.log(`${s}${s}${accent('--thread')}            ${secondary('Extract full Twitter thread')}`);
  console.log(`${s}${s}${accent('--model <id>')}        ${secondary('One-off model override')}`);
  console.log(`${s}${s}${accent('--verbose')}           ${secondary('Show technical details')}`);
  console.log('');

  // Examples section
  console.log(`${s}${style.header('EXAMPLES')}`);
  console.log(`${s}${dim('─'.repeat(50))}`);
  console.log('');
  console.log(`${s}${s}${muted('# Open library')}`);
  console.log(`${s}${s}${accent('twx')}`);
  console.log('');
  console.log(`${s}${s}${muted('# Analyze tweet')}`);
  console.log(`${s}${s}${accent('twx https://x.com/user/status/123456')}`);
  console.log('');
  console.log(`${s}${s}${muted('# Analyze full thread')}`);
  console.log(`${s}${s}${accent('twx https://x.com/user/status/123456 --thread')}`);
  console.log('');
  console.log(`${s}${s}${muted('# Analyze YouTube video')}`);
  console.log(`${s}${s}${accent('twx https://youtube.com/watch?v=abc')}`);
  console.log('');
  console.log(`${s}${s}${muted('# Get transcript only')}`);
  console.log(`${s}${s}${accent('twx https://youtube.com/watch?v=abc transcript')}`);
  console.log('');
  console.log(`${s}${s}${muted('# Video clip with Musk style')}`);
  console.log(`${s}${s}${accent('twx https://youtube.com/watch?v=abc --clip 1:00-5:00 musk')}`);
  console.log('');
}

export default { showUsage };
