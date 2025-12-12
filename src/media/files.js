import fs from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_MIME_TYPES, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, TEXT_EXTENSIONS } from './constants.js';

export async function collectMedia(targetPath, { recursive = true } = {}) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);

    if (entry.isFile()) {
      const type = getMediaType(entryPath);
      if (type) items.push({ path: entryPath, type });
    } else if (recursive && entry.isDirectory()) {
      const subItems = await collectMedia(entryPath, { recursive });
      items.push(...subItems);
    }
  }

  return items;
}

export function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_MIME_TYPES[ext]) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

