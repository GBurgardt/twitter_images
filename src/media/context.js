import fs from 'node:fs/promises';
import path from 'node:path';
import { readJSONIfExists } from '../system/fs.js';

export async function gatherContextForItems(items) {
  const contextMap = new Map();
  const infoCache = new Map();

  for (const item of items) {
    const absolutePath = path.resolve(item.path);
    const contexts = [];

    const perFileMeta = await readJSONIfExists(`${absolutePath}.json`);
    if (perFileMeta) {
      const ctx = extractContextText(perFileMeta);
      if (ctx) contexts.push(ctx);
    }

    const dir = path.dirname(absolutePath);
    let dirContext = infoCache.get(dir);
    if (dirContext === undefined) {
      dirContext = await loadInfoContext(dir);
      infoCache.set(dir, dirContext);
    }
    if (dirContext) contexts.push(dirContext);

    if (contexts.length) {
      contextMap.set(absolutePath, contexts.map((c) => `[MEDIA_CONTEXT]\n${c}`).join('\n'));
    }
  }

  return contextMap;
}

async function loadInfoContext(dir) {
  try {
    const entries = await fs.readdir(dir);
    const contexts = [];

    for (const name of entries) {
      if (!name.endsWith('.info.json')) continue;
      const meta = await readJSONIfExists(path.join(dir, name));
      if (meta) {
        const text = extractContextText(meta);
        if (text) contexts.push(text);
      }
    }

    return contexts.join('\n');
  } catch {
    return '';
  }
}

function extractContextText(meta) {
  if (!meta || typeof meta !== 'object') return '';

  const segments = new Set();
  const add = (label, value, max = 1200) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const limited = trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
    segments.add(`${label}: ${limited}`);
  };

  const textFields = [
    ['tweet_text', 'Texto del tweet'],
    ['full_text', 'Texto completo'],
    ['text', 'Texto'],
    ['description', 'Descripción'],
    ['caption', 'Caption'],
    ['title', 'Título'],
    ['summary', 'Resumen'],
    ['content', 'Contenido']
  ];

  for (const [key, label] of textFields) {
    add(label, meta[key]);
  }

  const poster = meta.author || meta.uploader || meta.owner || meta.channel;
  add('Autor', poster);

  if (meta.upload_date) segments.add(`Fecha: ${meta.upload_date}`);
  if (Array.isArray(meta.tags)) segments.add(`Tags: ${meta.tags.slice(0, 12).join(', ')}`);

  return Array.from(segments).join('\n');
}

