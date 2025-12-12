#!/usr/bin/env node
/**
 * twx - CLI wrapper
 *
 * Unified UX:
 * - `twx` opens the same library/chat UI as `twx <url>`
 * - Script handles history, chat, analysis, config, etc.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../src/extract-text.js');

function main() {
  const args = process.argv.slice(2);

  const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

main();
