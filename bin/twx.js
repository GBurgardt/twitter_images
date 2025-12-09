#!/usr/bin/env node
/**
 * twx - CLI wrapper
 *
 * Sin argumentos: abre interfaz interactiva
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

  // Detectar si debe abrir modo interactivo
  const hasUrl = args.some(arg => arg.startsWith('http://') || arg.startsWith('https://'));
  const hasPath = args.some(arg => !arg.startsWith('-') && !arg.startsWith('http'));
  const hasListCommand = args.includes('list') || args.includes('--list') || args.includes('-l');
  const hasConfigCommand = args.includes('config') || args.includes('--config');
  const hasHelp = args.includes('--help') || args.includes('-h');

  // Si no hay argumentos significativos Y es TTY, abrir modo interactivo
  const shouldInteractive = args.length === 0 ||
                            (args.length === 1 && (args[0] === '-i' || args[0] === '--interactive'));

  if (shouldInteractive && process.stdin.isTTY) {
    // Modo interactivo - usar node con tsx/esm loader para JSX
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
