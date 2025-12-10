#!/usr/bin/env node
/**
 * twx - CLI wrapper
 *
 * Sin argumentos: abre biblioteca con chat interactivo
 * Con URL u otros argumentos: modo script (ejecuta y sale)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../src/extract-text.js');

function main() {
  const args = process.argv.slice(2);

  // Si no hay argumentos Y es TTY, abrir biblioteca (list command)
  const shouldLibrary = args.length === 0 ||
                        (args.length === 1 && (args[0] === '-i' || args[0] === '--interactive'));

  if (shouldLibrary && process.stdin.isTTY) {
    // Abrir biblioteca - usa el mismo sistema de chat que twx <url>
    const child = spawn(process.execPath, [SCRIPT_PATH, 'list', '--limit', '50'], {
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
