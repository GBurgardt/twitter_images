#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../src/extract-text.js');

function showUsage() {
  console.error('\nUsage: twx <url-or-path> [style] [options]');
  console.error('Examples:');
  console.error('  twx https://x.com/user/status/123456 musk');
  console.error('  twx ./gallery-dl/twitter/thread buk --json');
  console.error('  twx list --limit 5');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    showUsage();
  }

  const target = args[0];
  if (target === 'list' || target === 'history' || target === '--list' || target === '-l') {
    const child = spawn(process.execPath, [SCRIPT_PATH, '--list', ...args.slice(1)], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    child.on('error', () => process.exit(1));
    return;
  }

  const maybeStyle = args[1] && !args[1].startsWith('-') ? args[1] : null;
  const restArgs = maybeStyle ? args.slice(2) : args.slice(1);

  let style = maybeStyle || process.env.TWX_DEFAULT_STYLE || 'musk';
  let customInstruction = null;

  if (maybeStyle && maybeStyle.toLowerCase() === 'tell') {
    style = 'musk';
    const idx = restArgs.findIndex((arg) => !arg.startsWith('-'));
    if (idx === -1) {
      console.error('\nUsage: twx <url-or-path> tell "your instruction" [options]');
      process.exit(1);
    }
    customInstruction = restArgs.splice(idx, 1)[0];
  }

  const cliArgs = [];
  if (/^https?:\/\//i.test(target)) {
    cliArgs.push('--url', target);
  } else {
    cliArgs.push('--path', target);
  }

  if (style) {
    cliArgs.push('--style', style);
  }

  if (customInstruction) {
    cliArgs.push('--style-text', customInstruction);
  }

  cliArgs.push(...restArgs);

  const child = spawn(process.execPath, [SCRIPT_PATH, ...cliArgs], { stdio: 'inherit' });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
  child.on('error', () => process.exit(1));
}

main();
