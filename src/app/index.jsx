#!/usr/bin/env node
/**
 * twx - Modo interactivo
 *
 * Ejecutar sin argumentos: abre la interfaz interactiva
 * Ejecutar con URL: analiza y sale (modo script)
 */

import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import App from './App.jsx';
import { connectToDatabase } from '../db.js';

// Verificar TTY
if (!process.stdin.isTTY) {
  console.error('twx requiere una terminal interactiva');
  console.error('Ejecuta: twx');
  process.exit(1);
}

// Limpiar pantalla
console.clear();

// Conectar a DB y renderizar
async function main() {
  try {
    await connectToDatabase();

    const { waitUntilExit } = render(<App />);

    await waitUntilExit();

    console.log('\n');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
