import fs from 'node:fs/promises';
import path from 'node:path';
import { readJSONIfExists } from '../../system/fs.js';
import { extractPrimaryText } from './primaryText.js';

export async function collectTextFromMetadata(baseDir) {
  const items = [];
  const queue = [baseDir];

  while (queue.length) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.name.endsWith('.info.json') || entry.name.endsWith('.json')) {
        const meta = await readJSONIfExists(entryPath);
        if (meta) {
          const text = extractPrimaryText(meta);
          if (text) {
            items.push({ path: entryPath, type: 'text', inlineText: text });
            return items;
          }
        }
      }
    }
  }

  return items;
}

