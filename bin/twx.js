#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../src/extract-text.js');

function showUsage() {
  console.error('\nUso: twx <url-o-ruta> [estilo] [opciones]');
  console.error('Ejemplos:');
  console.error('  twx https://x.com/user/status/123456 musk');
  console.error('  twx ./gallery-dl/twitter/thread buk --json');
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.length) {
  showUsage();
}

const target = args[0];
const maybeStyle = args[1] && !args[1].startsWith('-') ? args[1] : null;
const restArgs = maybeStyle ? args.slice(2) : args.slice(1);
const style = maybeStyle || process.env.TWX_DEFAULT_STYLE || 'musk';

const cliArgs = [];
if (/^https?:\/\//i.test(target)) {
  cliArgs.push('--url', target);
} else {
  cliArgs.push('--path', target);
}

if (style) {
  cliArgs.push('--style', style);
}

cliArgs.push(...restArgs);

const child = spawn(process.execPath, [SCRIPT_PATH, ...cliArgs], { stdio: 'inherit' });
child.on('exit', (code) => {
  process.exit(code ?? 0);
});
