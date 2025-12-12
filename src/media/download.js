import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { REDDIT_HOSTS, TWITTER_HOSTS, YTDLP_HOSTS } from './constants.js';
import { collectMedia } from './files.js';
import { runExternalCommand } from '../system/exec.js';
import { collectTextFromMetadata } from './text/metadata.js';
import { collectTextFromDump } from './text/dump.js';
import { collectTextFromFxApi } from './text/fxApi.js';
import { collectTextFromRedditUrl } from './text/reddit.js';
import { fetchTwitterThread } from './text/twitterThread.js';

export async function downloadRemoteMedia(url, config, { thread = false } = {}, { debug, HumanError }) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new HumanError(`Invalid URL: ${url}`, {
      tip: 'Make sure to copy the full URL.'
    });
  }

  const downloadRoot = config.downloadRoot || path.join(os.tmpdir(), 'twx-gallery-dl');

  const threadTextItems = [];
  if (thread && TWITTER_HOSTS.has(hostname)) {
    const threadItem = await fetchTwitterThread(url, { debug, HumanError });
    if (threadItem) threadTextItems.push(threadItem);
  }

  if (REDDIT_HOSTS.has(hostname)) {
    const redditTextItem = await collectTextFromRedditUrl(url, config, { debug, HumanError });
    return { baseDir: null, items: [...threadTextItems, ...(redditTextItem ? [redditTextItem] : [])] };
  }

  if (YTDLP_HOSTS.has(hostname)) {
    const ytResult = await downloadWithYtDlp(url, downloadRoot, { debug, HumanError });
    return { ...ytResult, items: [...threadTextItems, ...ytResult.items] };
  }

  const galleryResult = await downloadWithGalleryDl(url, downloadRoot, { debug, HumanError });
  return { ...galleryResult, items: [...threadTextItems, ...galleryResult.items] };
}

async function downloadWithGalleryDl(url, downloadRoot, { debug, HumanError }) {
  await fs.mkdir(downloadRoot, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(downloadRoot, 'run-'));

  if (debug) debug('Downloading with gallery-dl:', url);

  try {
    await runExternalCommand('gallery-dl', ['--quiet', '--write-info-json', '--write-metadata', '-d', runDir, url], { debug });
  } catch (error) {
    throw new HumanError('Could not download that content.', {
      tip: 'Check that the URL is public and gallery-dl is installed.',
      technical: error.message
    });
  }

  let items = await collectMedia(runDir, { recursive: true });

  if (!items.length) {
    const textItems = await collectTextFromMetadata(runDir);
    if (!textItems.length) {
      const dumpItems = await collectTextFromDump(url);
      textItems.push(...dumpItems);
    }
    if (!textItems.length) {
      const fxItem = await collectTextFromFxApi(url);
      if (fxItem) textItems.push(fxItem);
    }
    items.push(...textItems);
  }

  return { baseDir: runDir, items };
}

async function downloadWithYtDlp(url, downloadRoot, { debug, HumanError }) {
  await fs.mkdir(downloadRoot, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(downloadRoot, 'yt-'));

  if (debug) debug('Downloading with yt-dlp:', url);

  try {
    await runExternalCommand(
      'yt-dlp',
      [
        '-q',
        '-P',
        runDir,
        '-o',
        '%(title)s.%(ext)s',
        '-f',
        'bestaudio/best',
        '-x',
        '--audio-format',
        'mp3',
        '--no-progress',
        '--write-info-json',
        url
      ],
      { debug }
    );
  } catch (error) {
    throw new HumanError('Could not download that video.', {
      tip: 'Check that the URL is valid and yt-dlp is installed.',
      technical: error.message
    });
  }

  const items = await collectMedia(runDir, { recursive: true });
  return { baseDir: runDir, items };
}

