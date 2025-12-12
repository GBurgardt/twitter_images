/**
 * History & Library Module
 *
 * Elegant display for browsing saved analyses.
 * Features beautiful list navigation with visual hierarchy.
 */

import * as clack from '@clack/prompts';
import Fuse from 'fuse.js';
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
  const { onSelect = null } = options;

  // Show brand header
  console.log(brandHeader());

  if (!runs.length) {
    console.log(`${spacing.indent}${style.muted('Your library is empty.')}`);
    console.log('');
    console.log(`${spacing.indent}${style.secondary('Get started with:')} ${style.accent('twx <url>')}`);
    console.log('');
    return null;
  }

  // Sort: favorites first, then by date
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

  // Build choices with elegant formatting
  const choices = visible.map((run) => formatRunChoice(run));

  if (hasMore) {
    const moreCount = sorted.length - MAX_VISIBLE;
    choices.push({
      value: '__search__',
      label: `${style.accent(symbols.pointer)} ${style.secondary(`Search (${moreCount} more)`)}`,
      hint: '',
    });
  }

  console.log(`${spacing.indent}${style.header('LIBRARY')}`);
  console.log('');

  const selected = await clack.select({
    message: '',
    options: choices,
  });

  if (clack.isCancel(selected)) return null;

  if (selected === '__search__') {
    return await handleSearch(sorted, onSelect);
  }

  if (onSelect) await onSelect(selected);
  return selected;
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
 * Handle search flow
 */
async function handleSearch(runs, onSelect) {
  console.log('');

  const query = await clack.text({
    message: `${style.accent(symbols.pointer)} Search`,
    placeholder: 'Type to filter by title or content...',
  });

  if (clack.isCancel(query) || !query?.trim()) {
    return await showHistoryList(runs, { onSelect });
  }

  const filtered = searchRunsFuzzy(runs, query.trim());

  if (filtered.length === 0) {
    console.log('');
    console.log(`${spacing.indent}${style.warning(symbols.warning)} ${style.muted(`No results for "${query}"`)}`);
    console.log(`${spacing.indent}${style.dim('Try different keywords.')}`);
    return await handleSearch(runs, onSelect);
  }

  // Show results
  console.log('');
  console.log(`${spacing.indent}${style.success(symbols.success)} ${style.secondary(`${filtered.length} results`)}`);
  console.log('');

  const choices = filtered.slice(0, 15).map((run) => formatRunChoice(run));
  choices.push({
    value: '__back__',
    label: `${style.muted(symbols.arrowLeft)} ${style.secondary('Back to full list')}`,
    hint: '',
  });

  const selected = await clack.select({
    message: `Results for "${truncate(query, 20)}"`,
    options: choices,
  });

  if (clack.isCancel(selected)) return null;
  if (selected === '__back__') return await showHistoryList(runs, { onSelect });
  if (onSelect) await onSelect(selected);
  return selected;
}

/**
 * Fuzzy search through runs
 */
function searchRunsFuzzy(runs, query) {
  const searchableRuns = runs.map((run) => ({
    ...run,
    _searchTitle: getSmartTitle(run),
    _searchContent: run.finalResponse || '',
    _searchConversations: (run.conversations || [])
      .map((c) => `${c.question || ''} ${c.answer || ''}`)
      .join(' '),
  }));

  const fuse = new Fuse(searchableRuns, {
    keys: [
      { name: '_searchTitle', weight: 2 },
      { name: '_searchContent', weight: 1 },
      { name: '_searchConversations', weight: 0.5 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(query);
  return results.map((r) => r.item);
}

export default {
  showHistoryItem,
  showHistoryList,
};
