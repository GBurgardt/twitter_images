import * as clack from '@clack/prompts';
import Fuse from 'fuse.js';
import { stripXmlTags } from '../text/stripXmlTags.js';
import { showResult, showRawResult } from './output.js';

export function showHistoryItem(run, options = {}) {
  const { showTranscript = false } = options;

  const date = run.createdAt ? formatRelativeDate(new Date(run.createdAt)) : 'Fecha desconocida';
  const title = getSmartTitle(run);
  const source = run.source?.url || run.source?.path || '';

  console.log('');
  clack.log.info(`${date}`);
  console.log(`  ${title}`);

  if (source) console.log(`  ${truncate(source, 60)}`);

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
    clack.log.warn('Sin contenido almacenado');
  }

  if (showTranscript && run.results?.some((r) => r.text)) {
    console.log('');
    clack.log.info('Transcripción original:');
    for (const r of run.results.filter((r) => r.text)) {
      console.log('');
      console.log(`  [${r.type}] ${r.file || 'inline'}`);
      console.log(`  ${r.text.slice(0, 500)}${r.text.length > 500 ? '...' : ''}`);
    }
  }
}

export async function showHistoryList(runs, options = {}) {
  const { onSelect = null } = options;

  if (!runs.length) {
    console.log('');
    clack.log.info('No hay historial todavía.');
    clack.log.message('Usa "twx <url>" para analizar contenido.');
    return null;
  }

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
  if (hasMore) {
    choices.push({ value: '__search__', label: `🔍 Buscar (${sorted.length - MAX_VISIBLE} más)`, hint: '' });
  }

  const selected = await clack.select({ message: 'Biblioteca', options: choices });
  if (clack.isCancel(selected)) return null;

  if (selected === '__search__') return await handleSearch(sorted, onSelect);
  if (onSelect) await onSelect(selected);
  return selected;
}

function formatRunChoice(run) {
  const date = run.updatedAt || run.createdAt ? formatRelativeDate(new Date(run.updatedAt || run.createdAt)) : '';
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

function getSmartTitle(run) {
  if (run.title && run.title !== 'Untitled' && run.title.trim().length > 3 && !run.title.startsWith('http')) {
    return cleanTitle(run.title);
  }

  if (run.finalResponse) {
    const firstLine = extractFirstLine(run.finalResponse);
    if (firstLine && firstLine.length > 5) return truncateAtWord(firstLine, 50);
  }

  if (run.source?.url) {
    const url = run.source.url;
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) return pathParts[pathParts.length - 1].slice(0, 30);
      return parsed.hostname;
    } catch {
      return truncate(url, 40);
    }
  }

  return 'Sin título';
}

function cleanTitle(title) {
  if (!title) return 'Sin título';
  let clean = title;
  clean = clean.replace(/!\[.*?\]\(.*?\)/g, '').trim();
  clean = clean.replace(/https?:\/\/[^\s]+/g, '').trim();
  clean = clean.replace(/^#+\s*/, '').trim();
  clean = clean.replace(/^[\*\-•]\s*/, '').trim();
  clean = clean.replace(/<[^>]+>/g, '').trim();
  if (!clean || clean.length < 3) return 'Sin título';
  return clean;
}

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

function truncateAtWord(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > max * 0.6) return truncated.slice(0, lastSpace) + '...';
  return truncated.slice(0, max - 3) + '...';
}

async function handleSearch(runs, onSelect) {
  const query = await clack.text({
    message: 'Buscar:',
    placeholder: 'escribe para filtrar por título o contenido...'
  });

  if (clack.isCancel(query) || !query?.trim()) {
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
  choices.push({ value: '__back__', label: '← Volver a la lista completa', hint: '' });

  const selected = await clack.select({
    message: `Resultados para "${truncate(query, 20)}"`,
    options: choices
  });

  if (clack.isCancel(selected)) return null;
  if (selected === '__back__') return await showHistoryList(runs, { onSelect });
  if (onSelect) await onSelect(selected);
  return selected;
}

function searchRunsFuzzy(runs, query) {
  const searchableRuns = runs.map((run) => ({
    ...run,
    _searchTitle: getSmartTitle(run),
    _searchContent: run.finalResponse || '',
    _searchConversations: (run.conversations || []).map((c) => `${c.question || ''} ${c.answer || ''}`).join(' ')
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
  return results.map((r) => r.item);
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

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

  const day = date.getDate();
  const month = date.toLocaleString('es', { month: 'short' });
  return `${day} ${month}`;
}

