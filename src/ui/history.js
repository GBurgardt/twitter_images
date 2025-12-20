/**
 * History & Library Module
 *
 * Elegant display for browsing saved analyses.
 * Features beautiful list navigation with visual hierarchy.
 */

import Fuse from 'fuse.js';
import enquirer from 'enquirer';
import ansiEscapes from 'ansi-escapes';
import { stripXmlTags } from '../text/stripXmlTags.js';
import { showResult, showRawResult } from './output.js';
import {
  style,
  symbols,
  spacing,
  relativeTime,
  truncate,
  truncateWords,
  brandHeader,
} from './theme.js';

const { Select, AutoComplete } = enquirer;

/**
 * Show a single history item with elegant formatting
 */
export function showHistoryItem(run, options = {}) {
  const { showTranscript = false } = options;

  const date = run.createdAt ? relativeTime(new Date(run.createdAt)) : 'Unknown date';
  const title = getSmartTitle(run);
  const source = run.source?.url || run.source?.path || '';

  // Header
  console.log('');
  console.log(`${spacing.indent}${style.muted(date)}`);
  console.log(`${spacing.indent}${style.primary(title)}`);

  if (source) {
    console.log(`${spacing.indent}${style.dim(truncate(source, 60))}`);
  }

  // Content
  if (run.finalResponse) {
    showResult(stripXmlTags(run.finalResponse), { markdown: false });
  } else if (run.results?.some((r) => r.text)) {
    const combined = run.results
      .filter((r) => r.text)
      .map((r) => r.text)
      .join('\n\n');
    showRawResult(combined);
  } else {
    console.log('');
    console.log(`${spacing.indent}${style.warning(symbols.warning)} ${style.muted('No content stored')}`);
  }

  // Transcript (verbose)
  if (showTranscript && run.results?.some((r) => r.text)) {
    console.log('');
    console.log(`${spacing.indent}${style.info(symbols.info)} ${style.secondary('Original transcription:')}`);

    for (const r of run.results.filter((r) => r.text)) {
      console.log('');
      console.log(`${spacing.indent}${spacing.indent}${style.muted(`[${r.type}]`)} ${style.dim(r.file || 'inline')}`);
      console.log(`${spacing.indent}${spacing.indent}${r.text.slice(0, 500)}${r.text.length > 500 ? '...' : ''}`);
    }
  }
}

/**
 * Show the history list with elegant navigation
 */
export async function showHistoryList(runs, options = {}) {
  const { onSelect = null, onToggleFavorite = null } = options;

  if (!runs.length) {
    console.log(brandHeader());
    console.log(`${spacing.indent}${style.muted('Your library is empty.')}`);
    console.log('');
    console.log(`${spacing.indent}${style.secondary('Get started with:')} ${style.accent('twx <url>')}`);
    console.log('');
    return null;
  }

  let favoritesOnly = false;
  let statusLine = '';

  const sorted = sortRuns(runs);
  const listLimit = getListLimit();

  // Entrar al alternate screen buffer - evita scroll y mantiene terminal limpia
  if (process.stdout.isTTY) {
    process.stdout.write(ansiEscapes.enterAlternativeScreen);
    process.stdout.write(ansiEscapes.cursorHide);
  }

  // Función para salir limpiamente del alternate screen
  const exitAltScreen = () => {
    if (process.stdout.isTTY) {
      process.stdout.write(ansiEscapes.cursorShow);
      process.stdout.write(ansiEscapes.exitAlternativeScreen);
    }
  };

  try {
    while (true) {
      // Limpiar y posicionar cursor arriba
      process.stdout.write(ansiEscapes.cursorTo(0, 0));
      process.stdout.write(ansiEscapes.eraseScreen);

      const viewRuns = favoritesOnly ? sorted.filter((r) => r.isFavorite) : sorted;
      const choices = buildLibraryChoices(viewRuns, { favoritesOnly });

      const prompt = new Select({
        message: '',
        choices,
        prefix: '',
        separator: '',
        promptLine: false,
        rows: process.stdout.rows || 25,
        columns: process.stdout.columns || 80,
        limit: listLimit,
        footer: () => {
          const total = viewRuns.length;
          const modeIndicator = favoritesOnly ? style.gold('★ favoritos') : '';
          const count = style.muted(`${total} items`);
          const hints = style.dim('↵ abrir · / buscar · f ★ · F filtrar · q salir');

          let footer = modeIndicator ? `${modeIndicator}  ${count}  ${hints}` : `${count}  ${hints}`;
          if (statusLine) footer = `${footer}\n${spacing.indent}${statusLine}`;
          return footer;
        },
      });

      const originalKeypress = prompt.keypress.bind(prompt);
      prompt.keypress = async (input, event = {}) => {
        statusLine = '';

        if (input === 'q') {
          await prompt.cancel();
          return;
        }

        if (input === '/') {
          await prompt.cancel();
          prompt._searchRequested = true;
          return;
        }

        if (input === 'F') {
          await prompt.cancel();
          prompt._toggleFavoritesRequested = true;
          return;
        }

        if (input === 'f') {
          const focused = prompt.focused;
          const id = focused?.name;
          const isAction = id?.startsWith?.('__');
          if (!id || isAction) return;

          if (typeof onToggleFavorite !== 'function') {
            statusLine = style.warning(`Favorites unavailable`);
            await prompt.render();
            return;
          }

          try {
            const result = await onToggleFavorite(id);
            const isFav = Boolean(result?.isFavorite);
            const run = sorted.find((r) => r._id?.toString?.() === id);
            if (run) run.isFavorite = isFav;

            const choice = prompt.choices.find((c) => c.name === id);
            if (choice && run) {
              const formatted = formatRunChoice(run);
              choice.message = formatted.label;
            }

            statusLine = isFav ? style.success(`★ Guardado`) : style.muted('Removido de favoritos');
            await prompt.render();
          } catch (err) {
            statusLine = style.error(`Error al guardar`);
            await prompt.render();
          }
          return;
        }

        return await originalKeypress(input, event);
      };

      let selected;
      try {
        selected = await prompt.run();
      } catch {
        if (prompt._searchRequested) {
          const found = await handleSearchEnquirer(sorted, onSelect);
          if (found) {
            exitAltScreen();
            return found;
          }
          continue;
        }
        if (prompt._toggleFavoritesRequested) {
          favoritesOnly = !favoritesOnly;
          continue;
        }
        exitAltScreen();
        return null;
      }

      if (prompt._searchRequested) {
        const found = await handleSearchEnquirer(sorted, onSelect);
        if (found) {
          exitAltScreen();
          return found;
        }
        continue;
      }

      if (prompt._toggleFavoritesRequested) {
        favoritesOnly = !favoritesOnly;
        continue;
      }

      if (!selected) {
        exitAltScreen();
        return null;
      }

      exitAltScreen();
      if (onSelect) await onSelect(selected);
      return selected;
    }
  } finally {
    // Garantizar que siempre salimos del alternate screen
    exitAltScreen();
  }
}

/**
 * Format a run item as a choice for the selector
 * Formato columnar: [FECHA]   [TÍTULO...]   [MSGS] [FAV]
 */
function formatRunChoice(run) {
  const termWidth = process.stdout.columns || 80;

  // Anchos de columnas
  const dateWidth = 5;      // "  5d", "ayer", " 11h"
  const indicatorWidth = 8; // " (12) ★" o espacios
  const padding = 6;        // espacios entre columnas + margen selector
  const titleWidth = Math.max(25, termWidth - dateWidth - indicatorWidth - padding);

  // Fecha - alineada a la derecha
  const rawDate = run.updatedAt || run.createdAt
    ? relativeTime(new Date(run.updatedAt || run.createdAt))
    : '';
  const date = rawDate.padStart(dateWidth);

  // Título - truncado y con padding
  const title = getSmartTitle(run);
  const titleTruncated = truncateWords(title, titleWidth);
  const titlePadded = titleTruncated.padEnd(titleWidth);

  // Indicadores - mensajes y favorito
  const msgCount = (run.conversations || []).length;
  const msgBadge = msgCount > 0 ? `(${msgCount})`.padStart(4) : '    ';
  const favIcon = run.isFavorite ? symbols.star : ' ';

  // Composición final con estilos
  const label = `${style.muted(date)}  ${style.primary(titlePadded)}  ${style.dim(msgBadge)} ${style.gold(favIcon)}`;

  return {
    value: run._id.toString(),
    label,
  };
}

/**
 * Get a smart title from the run data
 * IMPORTANTE: Nunca debe contener newlines - rompe el formato columnar
 */
function getSmartTitle(run) {
  let title = 'Untitled';

  // Use explicit title if good
  if (run.title && run.title !== 'Untitled' && run.title.trim().length > 3 && !run.title.startsWith('http')) {
    title = cleanTitle(run.title);
  }
  // Extract from response
  else if (run.finalResponse) {
    const firstLine = extractFirstLine(run.finalResponse);
    if (firstLine && firstLine.length > 5) {
      title = truncateWords(firstLine, 50);
    }
  }
  // Extract from URL
  else if (run.source?.url) {
    const url = run.source.url;
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        title = pathParts[pathParts.length - 1].slice(0, 30);
      } else {
        title = parsed.hostname;
      }
    } catch {
      title = truncate(url, 40);
    }
  }

  // CRÍTICO: Eliminar cualquier newline o whitespace extra que rompa columnas
  return title.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Clean a title string - elimina markdown, URLs, y cualquier formato problemático
 */
function cleanTitle(title) {
  if (!title) return 'Untitled';
  let clean = title;
  clean = clean.replace(/[\n\r]+/g, ' ');           // Newlines → espacio
  clean = clean.replace(/!\[.*?\]\(.*?\)/g, '');    // Remove markdown images
  clean = clean.replace(/https?:\/\/[^\s]+/g, '');  // Remove URLs
  clean = clean.replace(/^#+\s*/, '');              // Remove markdown headers
  clean = clean.replace(/^[\*\-•]\s*/, '');         // Remove list bullets
  clean = clean.replace(/<[^>]+>/g, '').trim(); // Remove HTML tags
  if (!clean || clean.length < 3) return 'Untitled';
  return clean;
}

/**
 * Extract first meaningful line from content
 */
function extractFirstLine(content) {
  if (!content) return null;
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('<')) continue;
    if (line.startsWith('#')) continue;
    if (line.length < 10) continue;
    if (line.startsWith('*') || line.startsWith('-')) continue;
    return line;
  }
  return lines[0] || null;
}

/**
 * Handle search flow (interactive, enquirer)
 */
async function handleSearchEnquirer(runs, onSelect) {
  console.log('');

  const baseChoices = runs.map((run) => {
    const formatted = formatRunChoicePlain(run);
    return {
      name: formatted.value,
      message: formatted.label,
      _run: run,
    };
  });

  const prompt = new AutoComplete({
    message: `${style.accent(symbols.pointer)} Search`,
    choices: baseChoices,
    prefix: '',
    separator: '',
    rows: process.stdout.rows || 25,
    columns: process.stdout.columns || 80,
    limit: getListLimit(),
    footer: () => `${style.dim('Type to search')}  ${style.dim('Enter Open')}  ${style.dim('Esc Back')}`,
    suggest: (input, choices) => {
      const q = (input || '').trim();
      if (!q) return choices;
      const mappedRuns = choices.map((c) => c._run).filter(Boolean);
      const results = searchRunsFuzzy(mappedRuns, q).slice(0, 30);
      const byId = new Map(results.map((r) => [r._id.toString(), r]));
      return choices
        .filter((c) => byId.has(c.name))
        .sort((a, b) => results.indexOf(byId.get(a.name)) - results.indexOf(byId.get(b.name)));
    },
  });

  try {
    const selected = await prompt.run();
    if (!selected) return null;
    if (onSelect) await onSelect(selected);
    return selected;
  } catch {
    return null;
  }
}

/**
 * Fuzzy search through runs
 */
function searchRunsFuzzy(runs, query) {
  const q = normalizeSearchText(query);
  const searchableRuns = runs.map((run) => ({
    ...run,
    _searchTitle: normalizeSearchText(getSmartTitle(run)),
    _searchContent: normalizeSearchText(run.finalResponse || ''),
    _searchConversationsNorm: normalizeSearchText(
      (run.conversations || []).map((c) => `${c.question || ''} ${c.answer || ''}`).join(' ')
    ),
  }));

  const fuse = new Fuse(searchableRuns, {
    keys: [
      { name: '_searchTitle', weight: 2 },
      { name: '_searchContent', weight: 1 },
      { name: '_searchConversationsNorm', weight: 0.6 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(q);
  return results.map((r) => r.item);
}

function normalizeSearchText(text) {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortRuns(runs) {
  return [...runs].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    const dateA = new Date(a.updatedAt || a.createdAt);
    const dateB = new Date(b.updatedAt || b.createdAt);
    return dateB - dateA;
  });
}

function buildLibraryChoices(runs, { favoritesOnly }) {
  // Si está en modo favoritos y no hay ninguno, mostrar mensaje
  if (favoritesOnly && runs.length === 0) {
    return [{
      name: '__empty__',
      message: style.muted('  No hay favoritos. Presiona F para ver todos.'),
      disabled: true,
    }];
  }

  // Solo items - sin decoración, sin controles
  return runs.map((run) => {
    const formatted = formatRunChoice(run);
    return {
      name: formatted.value,
      message: formatted.label,
    };
  });
}

function getListLimit() {
  const rows = process.stdout.rows || 24;
  // Solo reservar espacio para footer (1 línea) + margen mínimo (2 líneas)
  const reserved = 3;
  return Math.max(10, rows - reserved);
}

function formatRunChoicePlain(run) {
  const termWidth = process.stdout.columns || 80;

  // Mismos anchos que formatRunChoice para consistencia
  const dateWidth = 5;
  const indicatorWidth = 8;
  const padding = 6;
  const titleWidth = Math.max(25, termWidth - dateWidth - indicatorWidth - padding);

  const rawDate = run.updatedAt || run.createdAt
    ? relativeTime(new Date(run.updatedAt || run.createdAt))
    : '';
  const date = rawDate.padStart(dateWidth);

  const title = getSmartTitle(run);
  const titleTruncated = truncateWords(title, titleWidth);
  const titlePadded = titleTruncated.padEnd(titleWidth);

  const msgCount = (run.conversations || []).length;
  const msgBadge = msgCount > 0 ? `(${msgCount})`.padStart(4) : '    ';
  const favIcon = run.isFavorite ? symbols.star : ' ';

  return {
    value: run._id.toString(),
    label: `${date}  ${titlePadded}  ${msgBadge} ${favIcon}`,
  };
}

export default {
  showHistoryItem,
  showHistoryList,
};
