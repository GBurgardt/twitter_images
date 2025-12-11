#!/usr/bin/env node
/**
 * twx - CLI wrapper
 *
 * Sin argumentos: abre app Ink (búsqueda primero, reactiva)
 * Con URL u otros argumentos: modo script (ejecuta y sale)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../src/extract-text.js');
const APP_PATH = path.join(__dirname, '../src/app/index.jsx');

function main() {
  const args = process.argv.slice(2);

  // Si no hay argumentos Y es TTY, abrir app Ink (experiencia search-first)
  const shouldLibrary = args.length === 0 ||
                        (args.length === 1 && (args[0] === '-i' || args[0] === '--interactive'));

  if (shouldLibrary && process.stdin.isTTY) {
    // Lanzar app Ink directamente - experiencia search-first
    const child = spawn(process.execPath, ['--import', 'tsx/esm', APP_PATH], {
      stdio: 'inherit',
      env: process.env
    });

    child.on('exit', (code) => process.exit(code ?? 0));
    child.on('error', (err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
  } else {
    // Modo script - ejecutar extract-text.js directamente
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
}

main();
