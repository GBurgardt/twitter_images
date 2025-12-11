/**
 * UI Module - Experiencia visual estilo Papiro
 *
 * Principios:
 * - Silencio por default
 * - El contenido respira (papiro sagrado)
 * - Markdown renderizado elegantemente
 * - Errores en lenguaje humano
 * - Verbose solo cuando se pide
 */

import * as clack from '@clack/prompts';
import readline from 'node:readline/promises';
import boxen from 'boxen';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import Fuse from 'fuse.js';

// Configure marked for elegant terminal output
marked.use(markedTerminal({
  // Slightly warm color scheme for papyrus feel
  reflowText: true,
  width: 76
}));

// Papyrus aesthetic: warm ochre border like aged parchment
const PAPYRUS_COLOR = '#C9A66B';

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
 * Renderiza Markdown y lo presenta en una caja elegante estilo papiro
 */
export function showResult(text, options = {}) {
  if (!text?.trim()) return;

  const { title = null } = options;

  // Render Markdown to terminal-formatted text
  const rendered = marked.parse(text);

  // Create the papyrus box
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

  const title = getSmartTitle(run);
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
 * Lista el historial con UX mejorada
 * - Máximo 10 items visibles
 * - Favoritos primero
 * - Opción de búsqueda si hay más
 * - Títulos limpios y bien truncados
 */
export async function showHistoryList(runs, options = {}) {
  const { onSelect = null } = options;

  if (!runs.length) {
    console.log('');
    clack.log.info('No hay historial todavía.');
    clack.log.message('Usa "twx <url>" para analizar contenido.');
    return null;
  }

  // Sort: favorites first, then by updatedAt
  const sorted = [...runs].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    const dateA = new Date(a.updatedAt || a.createdAt);
    const dateB = new Date(b.updatedAt || b.createdAt);
    return dateB - dateA;
  });

  const MAX_VISIBLE = 10;
  const hasMore = sorted.length > MAX_VISIBLE;
  const visible = sorted.slice(0, MAX_VISIBLE);

  console.log('');

  const choices = visible.map((run) => formatRunChoice(run));

  // Add search option if there are more items
  if (hasMore) {
    choices.push({
      value: '__search__',
      label: `🔍 Buscar (${sorted.length - MAX_VISIBLE} más)`,
      hint: ''
    });
  }

  const selected = await clack.select({
    message: 'Biblioteca',
    options: choices
  });

  if (clack.isCancel(selected)) {
    return null;
  }

  // Handle search
  if (selected === '__search__') {
    return await handleSearch(sorted, onSelect);
  }

  if (onSelect) {
    await onSelect(selected);
  }

  return selected;
}

/**
 * Format a run as a choice for the select menu
 */
function formatRunChoice(run) {
  const date = run.updatedAt || run.createdAt
    ? formatRelativeDate(new Date(run.updatedAt || run.createdAt))
    : '';
  const title = getSmartTitle(run);
  const msgCount = (run.conversations || []).length;
  const favorite = run.isFavorite ? '★ ' : '  ';
  const chatIndicator = msgCount > 0 ? ` (${msgCount})` : '';

  return {
    value: run._id.toString(),
    label: `${favorite}${truncateAtWord(title, 45)}${chatIndicator}`,
    hint: date
  };
}

/**
 * Get smart title with better fallbacks
 */
function getSmartTitle(run) {
  // Si tiene título real y útil
  if (run.title &&
      run.title !== 'Untitled' &&
      run.title.trim().length > 3 &&
      !run.title.startsWith('http')) {
    return cleanTitle(run.title);
  }

  // Fallback: primera línea útil del contenido
  if (run.finalResponse) {
    const firstLine = extractFirstLine(run.finalResponse);
    if (firstLine && firstLine.length > 5) {
      return truncateAtWord(firstLine, 50);
    }
  }

  // Último fallback: URL o path
  if (run.source?.url) {
    const url = run.source.url;
    // Extraer algo útil de la URL
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        return pathParts[pathParts.length - 1].slice(0, 30);
      }
      return parsed.hostname;
    } catch {
      return truncate(url, 40);
    }
  }

  return 'Sin título';
}

/**
 * Clean title for display
 */
function cleanTitle(title) {
  if (!title) return 'Sin título';

  let clean = title;

  // Remove markdown image syntax
  clean = clean.replace(/!\[.*?\]\(.*?\)/g, '').trim();

  // Remove standalone URLs
  clean = clean.replace(/https?:\/\/[^\s]+/g, '').trim();

  // Remove markdown headers
  clean = clean.replace(/^#+\s*/, '').trim();

  // Remove bullets and list markers
  clean = clean.replace(/^[\*\-•]\s*/, '').trim();

  // Remove XML tags
  clean = clean.replace(/<[^>]+>/g, '').trim();

  // If empty after cleaning
  if (!clean || clean.length < 3) {
    return 'Sin título';
  }

  return clean;
}

/**
 * Extract first meaningful line from content
 */
function extractFirstLine(content) {
  if (!content) return null;
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip XML-like lines
    if (line.startsWith('<')) continue;
    // Skip markdown headers
    if (line.startsWith('#')) continue;
    // Skip very short lines
    if (line.length < 10) continue;
    // Skip bullets
    if (line.startsWith('*') || line.startsWith('-')) continue;
    return line;
  }
  return lines[0] || null;
}

/**
 * Truncate at word boundary
 */
function truncateAtWord(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;

  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > max * 0.6) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated.slice(0, max - 3) + '...';
}

/**
 * Search functionality with fuzzy matching
 */
async function handleSearch(runs, onSelect) {
  const query = await clack.text({
    message: 'Buscar:',
    placeholder: 'escribe para filtrar por título o contenido...'
  });

  if (clack.isCancel(query) || !query?.trim()) {
    // Return to main list
    return await showHistoryList(runs, { onSelect });
  }

  const filtered = searchRunsFuzzy(runs, query.trim());

  if (filtered.length === 0) {
    clack.log.warn(`Sin resultados para "${query}"`);
    clack.log.message('Prueba con otros términos.');
    return await handleSearch(runs, onSelect);
  }

  console.log('');

  const choices = filtered.slice(0, 15).map((run) => formatRunChoice(run));

  // Add back option
  choices.push({
    value: '__back__',
    label: '← Volver a la lista completa',
    hint: ''
  });

  const selected = await clack.select({
    message: `Resultados para "${truncate(query, 20)}"`,
    options: choices
  });

  if (clack.isCancel(selected)) {
    return null;
  }

  if (selected === '__back__') {
    return await showHistoryList(runs, { onSelect });
  }

  if (onSelect) {
    await onSelect(selected);
  }

  return selected;
}

/**
 * Search runs with fuzzy matching using Fuse.js
 */
function searchRunsFuzzy(runs, query) {
  // Preparar datos para Fuse
  const searchableRuns = runs.map(run => ({
    ...run,
    _searchTitle: getSmartTitle(run),
    _searchContent: run.finalResponse || '',
    _searchConversations: (run.conversations || [])
      .map(c => `${c.question || ''} ${c.answer || ''}`)
      .join(' ')
  }));

  const fuse = new Fuse(searchableRuns, {
    keys: [
      { name: '_searchTitle', weight: 2 },
      { name: '_searchContent', weight: 1 },
      { name: '_searchConversations', weight: 0.5 }
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2
  });

  const results = fuse.search(query);
  return results.map(r => r.item);
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
export function showGoodbye(message = 'Hasta luego') {
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
 * Truncar texto
 */
function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/**
 * Formatear fecha relativa - EN ESPAÑOL
 */
function formatRelativeDate(date) {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return 'ayer';
  if (days < 7) return `${days}d`;

  // Formatted date in Spanish
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
