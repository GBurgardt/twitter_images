/**
 * UI Module - Experiencia visual estilo Apple
 *
 * Principios:
 * - Silencio por default
 * - El contenido respira
 * - Errores en lenguaje humano
 * - Verbose solo cuando se pide
 */

import * as clack from '@clack/prompts';
import readline from 'node:readline/promises';

// Configuración visual
const BORDER = '─'.repeat(55);
const VERBOSE = { enabled: false };

/**
 * Activa/desactiva modo verbose
 */
export function setVerbose(enabled) {
  VERBOSE.enabled = enabled;
}

/**
 * Log solo en modo verbose
 */
export function debug(...args) {
  if (VERBOSE.enabled) {
    console.log('[debug]', ...args);
  }
}

/**
 * Spinner simple y elegante
 */
export function spinner(message = 'Procesando...') {
  const s = clack.spinner();
  s.start(message);
  return {
    update: (msg) => s.message(msg),
    success: (msg) => s.stop(msg || message),
    error: (msg) => s.stop(msg || 'Error'),
    stop: () => s.stop()
  };
}

/**
 * Muestra el resultado principal (el insight del agente)
 */
export function showResult(text, options = {}) {
  const { title = null } = options;

  console.log('');
  console.log(`  ${BORDER}`);
  console.log('');

  if (title) {
    console.log(`  ${title}`);
    console.log('');
  }

  // Formatear el texto con indentación y wrapping
  const lines = text.split('\n');
  for (const line of lines) {
    const wrapped = wrapText(line.trim(), 53);
    for (const w of wrapped) {
      console.log(`  ${w}`);
    }
  }

  console.log('');
  console.log(`  ${BORDER}`);
  console.log('');
}

/**
 * Muestra el resultado raw (transcripción sin IA)
 */
export function showRawResult(text, options = {}) {
  const { label = 'Transcripción' } = options;

  console.log('');
  clack.log.info(label);
  console.log('');
  console.log(text);
  console.log('');
}

/**
 * Muestra un item del historial
 */
export function showHistoryItem(run, options = {}) {
  const { showTranscript = false } = options;

  const date = run.createdAt
    ? formatRelativeDate(new Date(run.createdAt))
    : 'Fecha desconocida';

  const title = run.title || 'Sin título';
  const source = run.source?.url || run.source?.path || '';

  console.log('');
  clack.log.info(`${date}`);
  console.log(`  ${title}`);

  if (source) {
    console.log(`  ${truncate(source, 60)}`);
  }

  if (run.finalResponse) {
    showResult(stripXmlTags(run.finalResponse));
  } else if (run.results?.some(r => r.text)) {
    const combined = run.results
      .filter(r => r.text)
      .map(r => r.text)
      .join('\n\n');
    showRawResult(combined);
  } else {
    console.log('');
    clack.log.warn('Sin contenido almacenado');
  }

  if (showTranscript && run.results?.some(r => r.text)) {
    console.log('');
    clack.log.info('Transcripción original:');
    for (const r of run.results.filter(r => r.text)) {
      console.log('');
      console.log(`  [${r.type}] ${r.file || 'inline'}`);
      console.log(`  ${r.text.slice(0, 500)}${r.text.length > 500 ? '...' : ''}`);
    }
  }
}

/**
 * Lista el historial de manera elegante
 */
export async function showHistoryList(runs, options = {}) {
  const { onSelect = null } = options;

  if (!runs.length) {
    console.log('');
    clack.log.info('No hay historial todavía.');
    clack.log.message('Usá "twx <url>" para analizar contenido.');
    return null;
  }

  console.log('');

  const choices = runs.map((run) => {
    const date = run.createdAt
      ? formatRelativeDate(new Date(run.createdAt))
      : '';
    const title = run.title || 'Sin título';
    const preview = stripXmlTags(run.finalResponse || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);

    return {
      value: run._id.toString(),
      label: truncate(title, 45),
      hint: date
    };
  });

  const selected = await clack.select({
    message: 'Historial reciente',
    options: choices
  });

  if (clack.isCancel(selected)) {
    return null;
  }

  if (onSelect) {
    await onSelect(selected);
  }

  return selected;
}

/**
 * Prompt de chat - multilinea por defecto
 *
 * - Enter = nueva línea
 * - Línea vacía (doble Enter) = enviar
 * - Ctrl+D = enviar
 */
export async function chatPrompt(options = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '› '
  });

  return new Promise((resolve) => {
    const lines = [];
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(result);
    };

    rl.on('line', (line) => {
      // Primera línea vacía = cancelar
      if (line === '' && lines.length === 0) {
        finish(null);
        return;
      }

      // Línea vacía después de contenido = enviar
      if (line === '' && lines.length > 0) {
        finish(lines.join('\n').trim() || null);
        return;
      }

      // exit/quit en primera línea
      if (lines.length === 0 && (line.toLowerCase() === 'exit' || line.toLowerCase() === 'quit')) {
        finish(line);
        return;
      }

      lines.push(line);
      rl.setPrompt('  ');
      rl.prompt();
    });

    // Ctrl+D = enviar lo que hay
    rl.on('close', () => {
      finish(lines.length > 0 ? lines.join('\n').trim() : null);
    });

    // Ctrl+C = cancelar
    rl.on('SIGINT', () => {
      finish(null);
    });

    rl.prompt();
  });
}


/**
 * Confirmar acción
 */
export async function confirm(message, defaultValue = true) {
  const result = await clack.confirm({
    message,
    initialValue: defaultValue
  });

  if (clack.isCancel(result)) {
    return false;
  }

  return result;
}

/**
 * Mensaje de inicio de sesión
 */
export function showWelcome() {
  console.log('');
  clack.intro('twx');
}

/**
 * Mensaje de fin de sesión
 */
export function showGoodbye(message = 'Goodbye') {
  clack.outro(message);
}

/**
 * Muestra progreso de procesamiento
 */
export function showProgress(current, total, item) {
  if (VERBOSE.enabled) {
    console.log(`  [${current}/${total}] ${item}`);
  }
}

/**
 * Muestra info de contexto (solo en verbose)
 */
export function showContext(context) {
  if (!VERBOSE.enabled || !context) return;

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

// ============ Utilidades ============

/**
 * Wrap text a un ancho específico
 */
function wrapText(text, width) {
  if (!text) return [''];

  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [''];
}

/**
 * Truncar texto
 */
function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/**
 * Formatear fecha relativa
 */
function formatRelativeDate(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  if (hours < 24) return `hace ${hours}h`;
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;

  // Fecha formateada
  const day = date.getDate();
  const month = date.toLocaleString('es', { month: 'short' });
  return `${day} ${month}`;
}

/**
 * Limpiar tags XML
 */
function stripXmlTags(text) {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '');
}

/**
 * Verifica si está en TTY interactivo
 */
export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export { clack };
