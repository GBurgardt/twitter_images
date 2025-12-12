import * as clack from '@clack/prompts';
import boxen from 'boxen';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { isVerbose } from './debug.js';

marked.use(
  markedTerminal({
    reflowText: true,
    width: 76
  })
);

const PAPYRUS_COLOR = '#C9A66B';

export function showResult(text, options = {}) {
  if (!text?.trim()) return;
  const { title = null } = options;

  const rendered = marked.parse(text);
  const box = boxen(rendered.trim(), {
    padding: 1,
    margin: { top: 1, bottom: 1 },
    borderStyle: 'round',
    borderColor: PAPYRUS_COLOR,
    title: title || undefined,
    titleAlignment: 'center'
  });

  console.log(box);
}

export function showRawResult(text, options = {}) {
  const { label = 'Transcripción' } = options;

  console.log('');
  clack.log.info(label);
  console.log('');
  console.log(text);
  console.log('');
}

export function showMetaLine(text) {
  if (!text) return;
  console.log(`\x1b[2m${text}\x1b[0m`);
}

export function showProgress(current, total, item) {
  if (isVerbose()) {
    console.log(`  [${current}/${total}] ${item}`);
  }
}

export function showContext(context) {
  if (!isVerbose() || !context) return;

  console.log('');
  clack.log.info('Contexto detectado:');
  const lines = context.split('\n').slice(0, 5);
  for (const line of lines) {
    console.log(`  ${truncate(line, 70)}`);
  }
  if (context.split('\n').length > 5) {
    console.log('  ...');
  }
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

