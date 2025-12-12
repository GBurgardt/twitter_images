import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { safeStat } from '../system/fs.js';
import { collectMedia, getMediaType } from './files.js';
import { downloadRemoteMedia } from './download.js';

export async function collectMediaItems(options, config, { debug, HumanError }) {
  const items = [];
  let cleanup = null;

  if (options.inputPath) {
    const stats = await safeStat(options.inputPath);
    if (!stats) {
      throw new HumanError(`Not found: ${options.inputPath}`, {
        tip: 'Check that the path is correct.'
      });
    }

    if (stats.isDirectory()) {
      const collected = await collectMedia(options.inputPath, { recursive: options.recursive });
      items.push(...collected);
    } else {
      const type = getMediaType(options.inputPath);
      if (!type) {
        throw new HumanError(`Unsupported file type: ${options.inputPath}`, {
          tip: 'Supported: images (jpg, png, gif, webp), audio (mp3, m4a, wav), video (mp4, mkv, mov)'
        });
      }
      items.push({ path: options.inputPath, type });
    }
  }

  if (options.url) {
    const download = await downloadRemoteMedia(options.url, config, { thread: options.thread }, { debug, HumanError });
    items.push(...download.items);

    if (download.baseDir && !config.keepDownloads) {
      cleanup = () => fs.rm(download.baseDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Back-compat: keepDownloads + TMP roots are managed by download modules.
  if (config.downloadRoot && config.downloadRoot.startsWith(os.tmpdir())) {
    // noop (historical)
  }

  return { items, cleanup };
}

