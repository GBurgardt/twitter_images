/**
 * History & Library Module
 *
 * Elegant display for browsing saved analyses.
 * Features beautiful list navigation with visual hierarchy.
 */

import Fuse from 'fuse.js';
import enquirer from 'enquirer';
import { stripXmlTags } from '../text/stripXmlTags.js';
import { showResult, showRawResult } from './output.js';
import {
  style,
  symbols,
  spacing,
  gradients,
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
    showResult(stripXmlTags(run.finalResponse));
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
  const listLimit = getHalfScreenListLimit();

  while (true) {
    if (process.stdout.isTTY) console.clear();
    console.log(brandHeader());

    const viewRuns = favoritesOnly ? sorted.filter((r) => r.isFavorite) : sorted;

    console.log(`${spacing.indent}${style.header('LIBRARY')}`);
    console.log('');

    const choices = buildLibraryChoices(viewRuns, { favoritesOnly });

    const prompt = new Select({
      message: '',
      choices,
      // Keep the UI calm: no leading "?" prompt line.
      prefix: '',
      separator: '',
      promptLine: false,
      rows: process.stdout.rows || 25,
      columns: process.stdout.columns || 80,
      limit: listLimit,
      footer: () => {
        const hint = `${style.dim('↑↓ Navigate')}  ${style.dim('Enter Open')}  ${style.dim('f Favorite')}  ${style.dim('F Favorites')}  ${style.dim('/ Search')}  ${style.dim('q Quit')}`;
        return statusLine ? `${hint}\n${spacing.indent}${statusLine}` : hint;
      },
    });

    const originalKeypress = prompt.keypress.bind(prompt);
    prompt.keypress = async (input, event = {}) => {
      // Any keypress clears transient status (unless we set it again).
      statusLine = '';

      if (input === 'q') {
        await prompt.cancel();
        return;
      }

      if (input === '/') {
        // Jump to search without moving selection.
        prompt.index = findChoiceIndex(prompt.choices, '__search__') ?? prompt.index;
        await prompt.submit();
        return;
      }

      if (input === 'F') {
        prompt.index = findChoiceIndex(prompt.choices, '__toggle_favorites__') ?? prompt.index;
        await prompt.submit();
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

          // Update the visible choice label in-place
          const choice = prompt.choices.find((c) => c.name === id);
          if (choice && run) {
            const formatted = formatRunChoice(run);
            choice.message = formatted.label;
            choice.hint = formatted.hint;
          }

          statusLine = isFav ? style.success(`Saved to favorites`) : style.muted('Removed from favorites');
          await prompt.render();
        } catch (err) {
          statusLine = style.error(`Could not save favorite`);
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
      return null;
    }

    if (!selected) return null;

    if (selected === '__toggle_favorites__') {
      favoritesOnly = !favoritesOnly;
      console.log('');
      continue;
    }

    if (selected === '__search__') {
      const found = await handleSearchEnquirer(sorted, onSelect);
      if (found) return found;
      console.log('');
      continue;
    }

    if (onSelect) await onSelect(selected);
    return selected;
  }
}

/**
 * Format a run item as a choice for the selector
 */
function formatRunChoice(run) {
  const date = run.updatedAt || run.createdAt
    ? relativeTime(new Date(run.updatedAt || run.createdAt))
    : '';
  const title = getSmartTitle(run);
  const msgCount = (run.conversations || []).length;

  // Indicators
  const favorite = run.isFavorite ? style.gold(symbols.star) + ' ' : '  ';
  const chatBadge = msgCount > 0 ? style.muted(` (${msgCount})`) : '';

  // Title styling
  const titleStyled = style.primary(truncateWords(title, 42));

  return {
    value: run._id.toString(),
    label: `${favorite}${titleStyled}${chatBadge}`,
    hint: style.dim(date),
  };
}

/**
 * Get a smart title from the run data
 */
function getSmartTitle(run) {
  // Use explicit title if good
  if (run.title && run.title !== 'Untitled' && run.title.trim().length > 3 && !run.title.startsWith('http')) {
    return cleanTitle(run.title);
  }

  // Extract from response
  if (run.finalResponse) {
    const firstLine = extractFirstLine(run.finalResponse);
    if (firstLine && firstLine.length > 5) {
      return truncateWords(firstLine, 50);
    }
  }

  // Extract from URL
  if (run.source?.url) {
    const url = run.source.url;
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

  return 'Untitled';
}

/**
 * Clean a title string
 */
function cleanTitle(title) {
  if (!title) return 'Untitled';
  let clean = title;
  clean = clean.replace(/!\[.*?\]\(.*?\)/g, '').trim(); // Remove markdown images
  clean = clean.replace(/https?:\/\/[^\s]+/g, '').trim(); // Remove URLs
  clean = clean.replace(/^#+\s*/, '').trim(); // Remove markdown headers
  clean = clean.replace(/^[\*\-•]\s*/, '').trim(); // Remove list bullets
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
      hint: formatted.hint,
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
    limit: getHalfScreenListLimit(),
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
  const choices = [
    {
      name: '__search__',
      message: `${style.accent(symbols.pointer)} ${style.secondary('Search')}`,
      hint: style.dim('/'),
    },
    {
      name: '__toggle_favorites__',
      message: `${style.gold(symbols.star)} ${style.secondary(`Favorites only: ${favoritesOnly ? 'On' : 'Off'}`)}`,
      hint: style.dim('F'),
    },
    {
      name: '__spacer__',
      message: style.dim(''),
      disabled: true,
    },
  ];

  if (favoritesOnly && runs.length === 0) {
    choices.push({
      name: '__empty__',
      message: style.muted('No favorites yet. Press F to show all.'),
      disabled: true,
    });
    return choices;
  }

  for (const run of runs) {
    const formatted = formatRunChoice(run);
    choices.push({
      name: formatted.value,
      message: formatted.label,
      hint: formatted.hint,
    });
  }

  return choices;
}

function findChoiceIndex(choices, name) {
  if (!Array.isArray(choices)) return null;
  const idx = choices.findIndex((c) => c?.name === name);
  return idx >= 0 ? idx : null;
}

function getHalfScreenListLimit() {
  const rows = process.stdout.rows || 24;
  // Rough budget: brand header (~10) + "LIBRARY" header (2) + footer (2) + breathing room (2)
  const reserved = 16;
  const available = Math.max(10, rows - reserved);
  return Math.max(6, Math.floor(available / 2));
}

function formatRunChoicePlain(run) {
  const date = run.updatedAt || run.createdAt
    ? relativeTime(new Date(run.updatedAt || run.createdAt))
    : '';
  const title = getSmartTitle(run);
  const msgCount = (run.conversations || []).length;

  const favorite = run.isFavorite ? `${symbols.star} ` : '';
  const chatBadge = msgCount > 0 ? ` (${msgCount})` : '';
  const titlePlain = truncateWords(title, 60);

  return {
    value: run._id.toString(),
    label: `${favorite}${titlePlain}${chatBadge}`,
    hint: date,
  };
}

export default {
  showHistoryItem,
  showHistoryList,
};
