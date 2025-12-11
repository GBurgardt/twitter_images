#!/usr/bin/env node
/**
 * twx - Twitter/X Media Insight CLI
 *
 * Experiencia rediseñada: silencio elegante, output limpio, errores humanos.
 */

import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { PDFDocument } from 'pdf-lib';

// Internal modules
import { loadConfig, isConfigured, runSetup, showConfig, resetConfig, saveConfig } from './config.js';
import * as ui from './ui.js';
import * as errors from './errors.js';
import { saveRun, listRuns, buildAutoTitle, getRunById } from './db.js';
import { streamAgent } from './agent/streamAgent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_PROMPT_MUSK_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt_musk.txt');
const AGENT_PROMPT_BUKOWSKI_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt_bukowski.txt');
const DEFAULT_SESSION_LOG = path.join(PROJECT_ROOT, 'current_session.txt');

// Load .env as fallback
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

// --- Streaming helpers for nicer CLI output ---
const ANSI_RESET = '\x1b[0m';

function createAnsiColor({ fg, bg }) {
  const parts = [];
  if (fg) parts.push(`38;2;${fg[0]};${fg[1]};${fg[2]}`);
  if (bg) parts.push(`48;2;${bg[0]};${bg[1]};${bg[2]}`);
  if (!parts.length) return '';
  return `\x1b[${parts.join(';')}m`;
}

function createBoxedStreamer(stdout, opts = {}) {
  const cols = stdout?.columns || 80;
  const innerWidth = Math.max(40, Math.floor(cols * (opts.widthRatio || 0.6)));
  const contentWidth = Math.max(10, innerWidth - 2); // leave a space before closing border
  const marginSize = Math.max(0, Math.floor((cols - innerWidth - 2) / 2));
  const margin = ' '.repeat(marginSize);
  let lineLen = 0;
  let lineOpen = false;

  const borderColor = opts.fgColor || [230, 230, 230];
  const textColorArr = opts.textColor || [240, 240, 240];
  const bgColor = opts.bgColor || [18, 18, 18]; // dark slate for contrast
  const borderAnsi = createAnsiColor({ fg: borderColor, bg: bgColor });
  const textAnsi = createAnsiColor({ fg: textColorArr, bg: bgColor });

  const writeTop = () => {
    stdout.write(`\n${margin}${borderAnsi}┌${'─'.repeat(innerWidth)}┐${ANSI_RESET}\n`);
  };

  const writeBottom = () => {
    stdout.write(`${margin}${borderAnsi}└${'─'.repeat(innerWidth)}┘${ANSI_RESET}\n`);
  };

  const openLine = () => {
    stdout.write(`${margin}${borderAnsi}│ ${textAnsi}`);
    lineOpen = true;
    lineLen = 0;
  };

  const closeLine = () => {
    const pad = Math.max(0, contentWidth - lineLen);
    stdout.write(`${' '.repeat(pad)} ${borderAnsi}│${ANSI_RESET}\n`);
    lineOpen = false;
    lineLen = 0;
  };

  const writeToken = (token) => {
    if (!token) return;

    if (token === '\n') {
      if (!lineOpen) openLine();
      closeLine();
      return;
    }

    // If the token is longer than the content width, hard-split
    if (token.length > contentWidth) {
      let remaining = token;
      while (remaining.length) {
        const slice = remaining.slice(0, contentWidth - lineLen);
        writeToken(slice);
        remaining = remaining.slice(slice.length);
      }
      return;
    }

    if (!lineOpen) openLine();
    if (lineLen + token.length > contentWidth && lineLen > 0) {
      closeLine();
      openLine();
    }

    stdout.write(token);
    lineLen += token.length;
  };

  const end = () => {
    if (lineOpen) closeLine();
    writeBottom();
  };

  return {
    start: writeTop,
    writeToken,
    end
  };
}

function createSmoothWriter(writer, { delayMs = 1 } = {}) {
  let pending = Promise.resolve();

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  const enqueue = (chunk) => {
    if (!chunk) return pending;
    pending = pending.then(async () => {
      // Split into words and whitespace to avoid mid-word breaks
      const tokens = chunk.match(/(\s+|[^\s]+)/g) || [];
      for (const token of tokens) {
        for (const ch of token) {
          writer.writeToken(ch);
          if (delayMs > 0) await sleep(delayMs);
        }
      }
    });
    return pending;
  };

  const flush = () => pending;

  return { enqueue, flush };
}

// Silence Google SDK message about duplicate API keys
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  const msg = args[0]?.toString?.() || '';
  if (msg.includes('GOOGLE_API_KEY') || msg.includes('GEMINI_API_KEY')) {
    return; // Silenciar
  }
  originalConsoleWarn.apply(console, args);
};

// Constantes
const MAX_INLINE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_WHISPER_FILE_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_TYPES = {
  '.apng': 'image/apng', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.webp': 'image/webp'
};

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.m4v']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.rtf']);

const STYLE_PRESETS = { musk: '', bukowski: '' };

const STYLE_ALIASES = {
  m: 'musk', mx: 'musk', max: 'musk', elon: 'musk', musk: 'musk',
  buk: 'bukowski', bukowski: 'bukowski', bk: 'bukowski'
};

const TWITTER_HOSTS = new Set(['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'mobile.twitter.com']);
const YTDLP_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
  'instagram.com', 'www.instagram.com', 'instagr.am'
]);
const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com']);
const TWITTER_THREAD_API = process.env.TWITTER_THREAD_API_URL || 'https://superexplainer.app/twitter-api/scrape_thread/';
const TWITTER_THREAD_MAX_TWEETS = (() => {
  const val = Number(process.env.TWITTER_THREAD_MAX_TWEETS) || 100;
  return Number.isFinite(val) ? Math.min(100, Math.max(1, val)) : 100;
})();

// ============ MAIN ============

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // Activar verbose si se pidió
  if (options.verbose) {
    ui.setVerbose(true);
  }

  // Comando: config
  if (options.configCommand) {
    if (options.configReset) {
      await resetConfig();
      ui.clack.log.success('Configuration reset.');
      return;
    }
    if (options.configShow) {
      await showConfig();
      return;
    }
    await runSetup({ force: true });
    return;
  }

  // Comando: list
  if (options.list) {
    await handleListCommand(options);
    return;
  }

  // Comando: cambio de modelo/proveedor
  if (options.modelCommand) {
    await handleModelCommand(options.modelValue);
    return;
  }

  // Comando: show
  if (options.showId) {
    await handleShowCommand(options.showId, options);
    return;
  }

  // Check configuration
  if (!await isConfigured()) {
    await runSetup();
    return;
  }

  // Comando: transcript (solo transcripción cruda, sin análisis)
  if (options.transcriptOnly) {
    await handleTranscriptCommand(options);
    return;
  }

  // Validar input
  if (!options.inputPath && !options.url) {
    showUsage();
    return;
  }

  // Load config
  const config = await loadConfig();
  const providerRaw = (config.agentProvider || 'gemini').toLowerCase();
  const agentProvider = providerRaw === 'claude' ? 'claude' : 'gemini';

  ui.debug('Config loaded:', { ...config, mistralApiKey: '***', geminiApiKey: '***', anthropicApiKey: '***', openaiApiKey: '***' });
  ui.debug('Options:', options);

  // Validate required API keys
  if (!config.mistralApiKey) {
    errors.show(new Error('Missing MISTRAL_API_KEY'));
    return;
  }

  // Inicializar clientes
  const geminiClient = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;
  const anthropicClient = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
  const openaiClient = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null;

  const agentAvailable = agentProvider === 'claude' ? Boolean(anthropicClient) : Boolean(geminiClient);

  // Procesar medios
  const spin = ui.spinner('Analyzing...');

  try {
    const { items: mediaItems, cleanup } = await collectMediaItems(options, config);

    if (!mediaItems.length) {
      spin.error('No content');
      errors.show(new errors.HumanError('No content found to process.', {
        tip: 'Check that the URL is valid or the folder contains image/audio/video files.'
      }));
      return;
    }

    ui.debug('Media items:', mediaItems.map(i => i.path));

    // Extraer texto de cada item
    const results = [];
    const contextMap = await gatherContextForItems(mediaItems);

    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const absolutePath = path.resolve(item.path);
      const relativePath = path.relative(process.cwd(), absolutePath) || absolutePath;

      spin.update(`Processing ${i + 1}/${mediaItems.length}...`);
      ui.debug('Processing:', relativePath, 'type:', item.type);

      try {
        let text = '';

        if (item.type === 'image') {
          text = await extractTextFromImage({ filePath: absolutePath, config });
        } else if (item.type === 'video' || item.type === 'audio') {
          if (!openaiClient) {
            throw new errors.HumanError('OpenAI API key required for audio/video transcription.', {
              tip: 'Run "twx config" to add your OpenAI key.'
            });
          }
          text = await transcribeMedia({ openaiClient, filePath: absolutePath, clipRange: options.clipRange, config });
        } else if (item.type === 'text') {
          text = await readPlainText(absolutePath, item.inlineText);
        }

        const context = contextMap.get(absolutePath) || null;
        results.push({ file: relativePath, type: item.type, text, context });
        ui.debug('Extracted:', { file: relativePath, chars: text?.length || 0 });

      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const context = contextMap.get(absolutePath) || null;
        results.push({ file: relativePath, type: item.type, error: message, context });
        ui.debug('Error processing:', relativePath, message);
      }
    }

    // Cleanup downloads temporales
    if (cleanup) {
      try { await cleanup(); } catch (e) { ui.debug('Cleanup error:', e); }
    }

    spin.success('Done');

    const normalizedStyle = normalizeStyle(options.style) || 'bukowski';

    // Ejecutar agente IA
    let agentData = null;
    let conversationHistory = [];

    if (results.some(r => r.text) && agentAvailable) {
      const agentResult = await runInsightAgent({
        provider: agentProvider,
        results,
        style: normalizedStyle,
        styleFile: options.styleFile,
        styleText: options.styleText,
        mode: options.mode || config.mode,
        config,
        directive: options.directive
      });

      if (agentResult) {
        agentData = agentResult.agentData;
        conversationHistory = agentResult.history || [];

        // Mostrar resultado
        if (agentData?.finalResponse && !agentResult.streamed) {
          ui.showResult(stripXmlTags(agentData.finalResponse), {
            title: agentData.title || null
          });
        }
      }
    } else if (results.some(r => r.text) && !agentAvailable) {
      const providerName = agentProvider === 'claude' ? 'Anthropic/Claude' : 'Gemini';
      errors.warn(`No ${providerName} key, cannot run AI analysis.`, {
        verbose: options.verbose,
        technical: `Add the missing API key or switch provider with "twx setmodel <gemini|opus>"`
      });

      const combined = results.filter(r => r.text).map(r => r.text).join('\n\n');
      if (combined) {
        ui.showRawResult(combined);
      }
    }

    // Save to history
    await persistRun({ options, config, results, agentData, rawMode: false, agentProvider, styleUsed: normalizedStyle });

    // Interactive chat mode
    if (agentProvider === 'gemini' && geminiClient && ui.isInteractive() && agentData?.finalResponse) {
      await startConversationLoop({
        results,
        options,
        config,
        conversationHistory
      });
    }

  } catch (error) {
    spin.error('Error');
    errors.show(error, { verbose: options.verbose });
    process.exit(1);
  }
}

// ============ MEDIA COLLECTION ============

async function collectMediaItems(options, config) {
  const items = [];
  let cleanup = null;

  if (options.inputPath) {
    const stats = await safeStat(options.inputPath);
    if (!stats) {
      throw new errors.HumanError(`Not found: ${options.inputPath}`, {
        tip: 'Check that the path is correct.'
      });
    }

    if (stats.isDirectory()) {
      const collected = await collectMedia(options.inputPath, { recursive: options.recursive });
      items.push(...collected);
    } else {
      const type = getMediaType(options.inputPath);
      if (!type) {
        throw new errors.HumanError(`Unsupported file type: ${options.inputPath}`, {
          tip: 'Supported: images (jpg, png, gif, webp), audio (mp3, m4a, wav), video (mp4, mkv, mov)'
        });
      }
      items.push({ path: options.inputPath, type });
    }
  }

  if (options.url) {
    const download = await downloadRemoteMedia(options.url, config, { thread: options.thread });
    items.push(...download.items);

    if (download.baseDir && !config.keepDownloads) {
      cleanup = () => fs.rm(download.baseDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return { items, cleanup };
}

async function collectMedia(targetPath, { recursive = true } = {}) {
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

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_MIME_TYPES[ext]) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

// ============ DOWNLOAD ============

async function downloadRemoteMedia(url, config, { thread = false } = {}) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new errors.HumanError(`Invalid URL: ${url}`, {
      tip: 'Make sure to copy the full URL.'
    });
  }

  const downloadRoot = config.downloadRoot || path.join(os.tmpdir(), 'twx-gallery-dl');

  const threadTextItems = [];
  if (thread && TWITTER_HOSTS.has(hostname)) {
    const threadItem = await fetchTwitterThread(url);
    if (threadItem) threadTextItems.push(threadItem);
  }

  if (REDDIT_HOSTS.has(hostname)) {
    const redditTextItem = await collectTextFromRedditUrl(url, config);
    return { baseDir: null, items: [...threadTextItems, ...(redditTextItem ? [redditTextItem] : [])] };
  }

  if (YTDLP_HOSTS.has(hostname)) {
    const ytResult = await downloadWithYtDlp(url, downloadRoot);
    return { ...ytResult, items: [...threadTextItems, ...ytResult.items] };
  }

  const galleryResult = await downloadWithGalleryDl(url, downloadRoot);
  return { ...galleryResult, items: [...threadTextItems, ...galleryResult.items] };
}

async function downloadWithGalleryDl(url, downloadRoot) {
  await fs.mkdir(downloadRoot, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(downloadRoot, 'run-'));

  ui.debug('Downloading with gallery-dl:', url);

  try {
    await runExternalCommand('gallery-dl', ['--quiet', '--write-info-json', '--write-metadata', '-d', runDir, url]);
  } catch (error) {
    throw new errors.HumanError('Could not download that content.', {
      tip: 'Check that the URL is public and gallery-dl is installed.',
      technical: error.message
    });
  }

  let items = await collectMedia(runDir, { recursive: true });

  // Si no hay medios, buscar texto en metadata
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

async function downloadWithYtDlp(url, downloadRoot) {
  await fs.mkdir(downloadRoot, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(downloadRoot, 'yt-'));

  ui.debug('Downloading with yt-dlp:', url);

  try {
    // Descargar y extraer audio en formato mp3 para compatibilidad con Whisper
    await runExternalCommand('yt-dlp', [
      '-q', '-P', runDir, '-o', '%(title)s.%(ext)s',
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'mp3',
      '--no-progress', '--write-info-json', url
    ]);
  } catch (error) {
    throw new errors.HumanError('Could not download that video.', {
      tip: 'Check that the URL is valid and yt-dlp is installed.',
      technical: error.message
    });
  }

  const items = await collectMedia(runDir, { recursive: true });
  return { baseDir: runDir, items };
}

// ============ OCR ============

async function extractTextFromImage({ filePath, config }) {
  if (!config.mistralApiKey) {
    throw new errors.HumanError('Mistral API key required for OCR.');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext] || 'image/png';
  const buffer = await fs.readFile(filePath);

  if (buffer.length > MAX_INLINE_FILE_BYTES) {
    throw new errors.HumanError('Image too large.', {
      tip: `Limit is 20MB. This image is ${Math.round(buffer.length / (1024 * 1024))}MB.`
    });
  }

  const pdfBuffer = await imageToPdfBuffer(buffer, mimeType);
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;

  const headers = {
    Authorization: `Bearer ${config.mistralApiKey}`,
    'Content-Type': 'application/json'
  };

  if (config.mistralOrgId) {
    headers['Mistral-Organization'] = config.mistralOrgId;
  }

  ui.debug('Calling Mistral OCR, bytes:', buffer.length);

  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.ocrModel || 'mistral-ocr-latest',
      document: { type: 'document_url', document_url: dataUrl }
    })
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new errors.HumanError('Mistral OCR failed.', {
      technical: `${response.status} ${response.statusText}: ${raw.slice(0, 200)}`
    });
  }

  const data = JSON.parse(raw);
  const text = extractMistralOcrText(data);

  if (!text) {
    throw new errors.HumanError('Could not read text from image.', {
      tip: 'Image may be too blurry or contain no text.'
    });
  }

  return text.trim();
}

async function imageToPdfBuffer(imageBuffer, mimeType) {
  const pdfDoc = await PDFDocument.create();
  let embedded;

  if (mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/gif') {
    embedded = await pdfDoc.embedPng(imageBuffer);
  } else {
    embedded = await pdfDoc.embedJpg(imageBuffer);
  }

  const page = pdfDoc.addPage([embedded.width, embedded.height]);
  page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });

  return Buffer.from(await pdfDoc.save());
}

function extractMistralOcrText(data) {
  const parts = [];
  const pages = data?.result?.pages || data?.pages;

  if (Array.isArray(pages)) {
    for (const page of pages) {
      const text = page?.text || page?.output_text || page?.content || page?.markdown;
      if (text) parts.push(String(text));
    }
  }

  if (data?.output_text) parts.push(String(data.output_text));
  if (data?.text) parts.push(String(data.text));
  if (data?.result?.text) parts.push(String(data.result.text));

  return parts.map(v => v.trim()).filter(Boolean).join('\n\n');
}

// ============ TRANSCRIPTION ============

async function transcribeMedia({ openaiClient, filePath, clipRange = null, config }) {
  const whisperSegmentSeconds = config.whisperSegmentSeconds || 480;
  const whisperBitrate = config.whisperBitrate || '48k';
  const whisperSampleRate = config.whisperSampleRate || '16000';

  // Clip si se pidió
  const clipped = await clipMediaSegment(filePath, clipRange, { whisperBitrate, whisperSampleRate });

  // Preparar audio
  const prepared = await prepareAudioForWhisper(clipped.path, { whisperBitrate, whisperSampleRate });

  // Split si es muy grande
  const segmented = await splitAudioIfNeeded(prepared.path, { whisperSegmentSeconds, whisperBitrate, whisperSampleRate });

  const cleanupTasks = [clipped.cleanup, prepared.cleanup, segmented.cleanup].filter(Boolean);
  const parts = [];

  try {
    for (const segmentPath of segmented.paths) {
      const stream = createReadStream(segmentPath);
      const response = await openaiClient.audio.transcriptions.create({
        model: config.transcribeModel || 'whisper-1',
        file: stream,
        response_format: 'text'
      });

      const text = typeof response === 'string' ? response : response.text;
      if (text?.trim()) parts.push(text.trim());
    }
  } finally {
    for (const cleanup of cleanupTasks) {
      if (cleanup) await cleanup();
    }
  }

  if (!parts.length) {
    throw new errors.HumanError('Could not transcribe audio.', {
      tip: 'File may be empty or in an unsupported format.'
    });
  }

  return parts.join('\n\n');
}

async function prepareAudioForWhisper(filePath, { whisperBitrate, whisperSampleRate }) {
  const stats = await fs.stat(filePath);
  if (stats.size <= MAX_WHISPER_FILE_BYTES) {
    return { path: filePath, cleanup: null };
  }

  ui.debug('Compressing audio for Whisper...');
  return transcodeForWhisper(filePath, { whisperBitrate, whisperSampleRate });
}

async function transcodeForWhisper(filePath, { whisperBitrate, whisperSampleRate }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-audio-'));
  const basename = path.basename(filePath, path.extname(filePath));
  const targetPath = path.join(tmpDir, `${basename}-twx.m4a`);

  try {
    await runExternalCommand('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', filePath, '-vn', '-ac', '1',
      '-ar', whisperSampleRate, '-b:a', whisperBitrate, targetPath
    ]);
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new errors.HumanError('ffmpeg required to compress audio.', {
      tip: 'Install with: brew install ffmpeg',
      technical: error.message
    });
  }

  return {
    path: targetPath,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

async function clipMediaSegment(filePath, clipRange, { whisperBitrate, whisperSampleRate }) {
  if (!clipRange || (clipRange.start == null && clipRange.end == null)) {
    return { path: filePath, cleanup: null };
  }

  const start = Math.max(0, clipRange.start ?? 0);
  const end = clipRange.end != null ? Math.max(clipRange.end, 0) : null;
  const duration = end != null ? Math.max(0, end - start) : null;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-clip-'));
  const basename = path.basename(filePath, path.extname(filePath));
  const targetPath = path.join(tmpDir, `${basename}-clip.m4a`);

  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(start), '-i', filePath,
    '-vn', '-ac', '1', '-ar', whisperSampleRate, '-b:a', whisperBitrate
  ];

  if (duration && duration > 0) args.push('-t', String(duration));
  args.push(targetPath);

  try {
    await runExternalCommand('ffmpeg', args);
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new errors.HumanError('Error clipping audio.', { technical: error.message });
  }

  return {
    path: targetPath,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

async function splitAudioIfNeeded(filePath, { whisperSegmentSeconds, whisperBitrate, whisperSampleRate }) {
  const stats = await fs.stat(filePath);
  if (stats.size <= MAX_WHISPER_FILE_BYTES) {
    return { paths: [filePath], cleanup: null };
  }

  ui.debug(`Splitting audio into ~${Math.round(whisperSegmentSeconds / 60)} min chunks...`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-chunks-'));
  const pattern = path.join(tmpDir, 'chunk-%03d.m4a');

  await runExternalCommand('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', filePath, '-vn', '-ac', '1',
    '-ar', whisperSampleRate, '-b:a', whisperBitrate,
    '-f', 'segment', '-segment_time', String(whisperSegmentSeconds), pattern
  ]);

  const entries = await fs.readdir(tmpDir);
  const paths = entries
    .filter(n => n.startsWith('chunk-') && n.endsWith('.m4a'))
    .map(n => path.join(tmpDir, n))
    .sort();

  if (!paths.length) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new errors.HumanError('Error splitting audio.');
  }

  return {
    paths,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

async function readPlainText(filePath, inlineText = null) {
  if (inlineText) return String(inlineText).trim();
  const data = await fs.readFile(filePath, 'utf8');
  return data.trim();
}

function maskConfig(config = {}) {
  const clone = { ...config };
  for (const key of Object.keys(clone)) {
    const lower = key.toLowerCase();
    if (lower.includes('key') || lower.includes('secret') || lower.includes('token') || lower.includes('url') || lower.includes('password')) {
      clone[key] = '***';
    }
  }
  return clone;
}

// ============ AGENT ============

async function runInsightAgent({ provider, results, style, styleFile, styleText, mode, config, directive }) {
  const normalizedStyle = normalizeStyle(style) || 'bukowski';
  const promptPath = resolveAgentPromptPath(normalizedStyle);
  const promptSource = await fs.readFile(promptPath, 'utf8');

  const providerKey = provider === 'claude' ? 'claude' : 'gemini';
  const preset = '';
  const customStyle = '';
  const defaultGeminiModel = 'gemini-3-pro-preview';
  const defaultClaudeModel = 'claude-opus-4.5';
  const configModel = (config.agentModel || '').toString();
  const model = providerKey === 'claude'
    ? (configModel.toLowerCase().includes('claude') ? configModel : defaultClaudeModel)
    : (configModel.toLowerCase().includes('gemini') ? configModel : defaultGeminiModel);

  const spin = ui.spinner('Thinking...');

  let payload = '';

  try {
    payload = buildAgentPayload({
      results,
      styleKey: normalizedStyle,
      preset,
      customStyle,
      directive
    });
    ui.debug('Agent payload length:', payload.length);
    ui.debug('Agent request meta:', {
      model,
      config: maskConfig(config)
    });

    let streamed = false;
    let boxWriter = null;
    let smooth = null;

    const { agentData, history } = await streamAgent({
      provider: providerKey,
      model,
      promptSource,
      payload,
      config,
      onStartStreaming: () => {
        streamed = true;
        spin.success('');
        boxWriter = createBoxedStreamer(process.stdout, { widthRatio: 0.6 });
        boxWriter.start();
        smooth = createSmoothWriter(boxWriter);
      },
      onToken: (textChunk) => {
        if (!textChunk) return;
        if (!boxWriter) {
          boxWriter = createBoxedStreamer(process.stdout, { widthRatio: 0.6 });
          boxWriter.start();
          smooth = createSmoothWriter(boxWriter);
        }
        smooth.enqueue(textChunk);
      }
    });

    // Si nunca se disparó el streaming (respuesta corta), cerrar spinner
    if (!streamed) {
      spin.success('');
    } else {
      await smooth.flush();
      boxWriter.end();
      if (process.stdout.isTTY) console.log('');
    }

    // Adjuntar ruta del prompt para persistencia
    agentData.promptPath = promptPath;

    return { agentData, history, streamed };

  } catch (error) {
    spin.error('Error');
    ui.debug('Agent error:', error);
    ui.debug('Agent error detail:', {
      error,
      model,
      payloadLength: payload?.length || 0,
      config: maskConfig(config)
    });

    if (error?.status === 429 || error?.message?.includes('quota')) {
      throw new errors.HumanError('API rate limit reached.', {
        tip: 'Wait a few minutes before trying again.'
      });
    }

    throw error;
  }
}

function buildAgentPayload({ results, styleKey, preset, customStyle, directive }) {
  const blocks = [];

  blocks.push('Idioma obligatorio: español neutro, tono directo y pragmático.');
  blocks.push('IMPORTANTE: Devuelve el XML con TODOS los tags requeridos: <response><title>...</title><internal_reflection>...</internal_reflection><action_plan>...</action_plan><final_response>...</final_response></response>');
  blocks.push(`Style preset: ${styleKey || 'none'}`);

  if (directive?.trim()) {
    blocks.push(`Instrucción del usuario (obligatoria, prioritaria):\n${directive.trim()}`);
  }

  if (preset) blocks.push(`Preset instructions:\n${preset}`);
  if (customStyle?.trim()) blocks.push(`User custom instructions:\n${customStyle.trim()}`);

  blocks.push(
    'Materiales analizados:\n' +
    results.map((entry, i) => {
      const base = [`Item ${i + 1}`, `Archivo: ${entry.file}`, `Tipo: ${entry.type}`];
      if (entry.error) {
        base.push(`Error: ${entry.error}`);
      } else {
        base.push(`Texto:\n${entry.text || '[Sin texto]'}`);
      }
      if (entry.context) {
        base.push(`Contexto:\n${entry.context}`);
      }
      return base.join('\n');
    }).join('\n\n')
  );

  return blocks.join('\n\n');
}

// ============ CHAT ============

async function startConversationLoop({ results, options, config, conversationHistory, runId = null }) {
  const normalizedStyle = normalizeStyle(options.style) || 'bukowski';
  const promptPath = resolveAgentPromptPath(normalizedStyle);
  const promptSource = await fs.readFile(promptPath, 'utf8');
  const preset = '';
  const chatModel = (config.agentModel && config.agentModel.toLowerCase().includes('gemini'))
    ? config.agentModel
    : 'gemini-3-pro-preview';

  console.log('');
  ui.clack.log.info('Chat mode. Type question or empty to return.');

  while (true) {
    const input = await ui.chatPrompt();

    if (!input || input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit' || input.toLowerCase() === 'back') {
      break;  // Return to list silently
    }

    const spin = ui.spinner('Thinking...');

    try {
      const payload = buildAgentPayload({
        results,
        styleKey: normalizedStyle,
        preset,
        customStyle: input,
        directive: options.directive
      });

      let streamed = false;
      let boxWriter = null;
      let smooth = null;
      let agentData = null;
      let history = null;

      ui.debug('Chat stream request:', {
        model: chatModel,
        payloadLength: payload.length,
        historyLength: conversationHistory.length,
        historyRoles: conversationHistory.map(h => h.role),
        config: maskConfig(config)
      });

      try {
        const streamedResult = await streamAgent({
          provider: 'gemini', // Chat loop es solo para Gemini
          model: chatModel,
          promptSource,
          payload,
          config,
          history: conversationHistory,
          onStartStreaming: () => {
            streamed = true;
            spin.success('');
            boxWriter = createBoxedStreamer(process.stdout, { widthRatio: 0.6 });
            boxWriter.start();
            smooth = createSmoothWriter(boxWriter);
          },
          onToken: (textChunk) => {
            if (!textChunk) return;
            if (!boxWriter) {
              boxWriter = createBoxedStreamer(process.stdout, { widthRatio: 0.6 });
              boxWriter.start();
              smooth = createSmoothWriter(boxWriter);
            }
            smooth.enqueue(textChunk);
          }
        });
        agentData = streamedResult.agentData;
        history = streamedResult.history;
      } catch (err) {
        // Fallback a no-stream cuando el streaming falla (ej. 500 internos)
        ui.debug('Chat streaming failed, fallback to non-stream:', err?.message, err?.stack);
        ui.debug('Chat streaming error detail:', {
          error: err,
          model: chatModel,
          payloadLength: payload.length,
          historyLength: conversationHistory.length,
          historyRoles: conversationHistory.map(h => h.role),
          config: maskConfig(config)
        });
        const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
        const userContent = { role: 'user', parts: [{ text: payload }] };
        ui.debug('Chat fallback request:', {
          model: chatModel,
          payloadLength: payload.length,
          historyLength: conversationHistory.length,
          historyRoles: conversationHistory.map(h => h.role),
          config: maskConfig(config)
        });
        const response = await client.models.generateContent({
          model: chatModel,
          contents: [...conversationHistory, userContent],
          systemInstruction: { parts: [{ text: promptPath ? await fs.readFile(promptPath, 'utf8') : '' }] },
          config: {
            maxOutputTokens: config.agentMaxOutputTokens || 64000,
            temperature: 1,
            thinkingLevel: config.thinkingLevel || 'HIGH',
            mediaResolution: config.mediaResolution || 'MEDIA_RESOLUTION_HIGH'
          }
        });
        spin.success('');
        const rawXml = extractResponseText(response)?.trim() ?? '';
        const xml = extractResponseBlock(rawXml);
        let finalResponse = '';
        if (xml) {
          finalResponse = extractTag(xml, 'final_response') || xml.replace(/^<response[^>]*>/, '').replace(/<\/response>$/, '').trim();
        } else if (rawXml.length > 0) {
          finalResponse = rawXml;
        }
        agentData = {
          reflection: extractTag(xml, 'internal_reflection'),
          plan: extractTag(xml, 'action_plan'),
          finalResponse,
          title: extractTag(xml, 'title'),
          xml,
          promptPath
        };
        history = [...conversationHistory, userContent, response?.candidates?.[0]?.content].filter(Boolean);
      }

      if (!streamed) {
        spin.success('');
      } else {
        await smooth.flush();
        boxWriter.end();
        if (process.stdout.isTTY) console.log('');
      }

      const cleanResponse = stripXmlTags(agentData.finalResponse || '');
      if (cleanResponse) {
        if (!streamed) ui.showResult(cleanResponse);
        conversationHistory = history || conversationHistory;

        if (runId) {
          try {
            const { addConversation } = await import('./db.js');
            await addConversation(runId, input, cleanResponse);
            ui.debug('Conversation saved to DB');
          } catch (saveErr) {
            ui.debug('Failed to save conversation:', saveErr.message);
          }
        }
      } else {
        ui.debug('Chat no response to show');
      }

    } catch (error) {
      spin.error('Error');
      ui.debug('Chat error:', error);
      ui.debug('Chat error detail:', {
        error,
        model: chatModel,
        payloadLength: payload.length,
        historyLength: conversationHistory.length,
        historyRoles: conversationHistory.map(h => h.role),
        config: maskConfig(config)
      });

      // Better error messages for common cases
      if (error?.status === 500) {
        errors.warn('Server error. Try again.', { verbose: options.verbose, technical: error.message });
      } else if (error?.status === 429) {
        errors.warn('Rate limit. Wait a moment.', { verbose: options.verbose, technical: error.message });
      } else {
        errors.warn('Could not respond.', { verbose: options.verbose, technical: error.message });
      }
    }
  }
}

// ============ HISTORY ============

/**
 * Library loop: list → chat → list → chat → ...
 * Only exits on explicit quit (q) or Ctrl+C
 */
async function handleListCommand(options) {
  try {
    // Loop until user quits
    while (true) {
      // Load runs fresh EVERY time we show the list
      // This ensures new insights from other processes appear
      const runs = await listRuns({ limit: options.listLimit || 100 });

      const selected = await ui.showHistoryList(runs, {});

      // User cancelled (Ctrl+C or q)
      if (!selected) {
        ui.clack.log.message('Hasta luego.');
        break;
      }

      // Open the selected insight with chat
      await handleShowCommand(selected, options);

      // Loop back to list - will load fresh data
    }

  } catch (error) {
    errors.show(error, { verbose: options.verbose });
  }
}

async function handleModelCommand(value) {
  const raw = (value || '').trim();

  if (!raw) {
    console.log('\nUsage: twx setmodel <gemini|opus|claude|model-id>\n');
    return;
  }

  const normalized = raw.toLowerCase();
  const presets = {
    gemini: { provider: 'gemini', model: 'gemini-3-pro-preview' },
    g3: { provider: 'gemini', model: 'gemini-3-pro-preview' },
    g3pro: { provider: 'gemini', model: 'gemini-3-pro-preview' },
    g3max: { provider: 'gemini', model: 'gemini-3-pro-preview' },
    opus: { provider: 'claude', model: 'claude-opus-4.5' },
    claude: { provider: 'claude', model: 'claude-opus-4.5' },
    'claude-opus': { provider: 'claude', model: 'claude-opus-4.5' },
    'claude-opus-4.5': { provider: 'claude', model: 'claude-opus-4.5' }
  };

  const preset = presets[normalized] || null;
  const provider = preset?.provider || (normalized.includes('claude') || normalized.includes('opus') ? 'claude' : 'gemini');
  const model = preset?.model || raw;

  const saved = await saveConfig({ agentProvider: provider, agentModel: model });

  if (saved) {
    console.log(`\nAI provider set to ${provider} (model: ${model}).\n`);
    console.log('Defaults: max output tokens 64000, temperature 1, thinking level HIGH.');
  } else {
    console.log('\nCould not save the requested model change.\n');
  }
}

async function handleShowCommand(id, options = {}) {
  try {
    const run = await getRunById(id);

    if (!run) {
      ui.clack.log.error(`Entry not found: ${id}`);
      return;
    }

    ui.showHistoryItem(run, { showTranscript: options.showTranscript });

    // Show previous conversations if any
    const dbConversations = run.conversations || [];
    if (dbConversations.length > 0) {
      console.log('');
      ui.clack.log.info(`${dbConversations.length} previous message${dbConversations.length > 1 ? 's' : ''}`);
      for (const conv of dbConversations) {
        console.log('');
        console.log(`  \x1b[2mYou: ${conv.question}\x1b[0m`);
        console.log('');
        ui.showResult(stripXmlTags(conv.answer || ''));
      }
    }

    // Chat mode si está disponible
    const config = await loadConfig();
    const provider = (run.agentProvider || config.agentProvider || 'gemini').toLowerCase();
    const canChat = ui.isInteractive() && provider === 'gemini' && config.geminiApiKey && (run.finalResponse || run.results?.some(r => r.text));

    if (canChat) {
      // Build conversation history from DB conversations
      const conversationHistory = [];

      // Add original response
      if (run.finalResponse) {
        conversationHistory.push({ role: 'model', parts: [{ text: run.finalResponse }] });
      }

      // Add previous conversations from DB
      for (const conv of dbConversations) {
        conversationHistory.push({ role: 'user', parts: [{ text: conv.question }] });
        if (conv.answer) {
          conversationHistory.push({ role: 'model', parts: [{ text: conv.answer }] });
        }
      }

      await startConversationLoop({
        results: run.results || [],
        options: { style: run.style, mode: run.mode },
        config,
        conversationHistory,
        runId: run._id  // Pass runId to save conversations
      });
    }

  } catch (error) {
    errors.show(error, { verbose: options.verbose });
  }
}

// ============ TRANSCRIPT ============

/**
 * Comando transcript: descarga audio de YouTube con yt-dlp y transcribe con Whisper API
 * Devuelve el transcript CRUDO sin análisis de IA
 *
 * Uso: twx <youtube-url> transcript
 */
async function handleTranscriptCommand(options) {
  const url = options.url;

  if (!url) {
    errors.show(new errors.HumanError('URL requerida para transcript.', {
      tip: 'Uso: twx <youtube-url> transcript'
    }));
    return;
  }

  // Verificar que sea una URL de YouTube
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    errors.show(new errors.HumanError('URL inválida.', {
      tip: 'Asegúrate de copiar la URL completa.'
    }));
    return;
  }

  if (!YTDLP_HOSTS.has(hostname)) {
    errors.show(new errors.HumanError('Solo URLs de YouTube/Instagram soportadas para transcript.', {
      tip: `Host detectado: ${hostname}. Usa una URL de youtube.com o youtu.be`
    }));
    return;
  }

  // Cargar config
  const config = await loadConfig();

  if (!config.openaiApiKey) {
    errors.show(new errors.HumanError('OpenAI API key requerida para transcripción.', {
      tip: 'Ejecuta "twx config" para agregar tu clave de OpenAI.'
    }));
    return;
  }

  const openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  const downloadRoot = config.downloadRoot || path.join(os.tmpdir(), 'twx-transcript');

  const spin = ui.spinner('Downloading audio...');

  try {
    // Paso 1: Descargar audio con yt-dlp
    ui.debug('Transcript: downloading audio from', url);
    await fs.mkdir(downloadRoot, { recursive: true });
    const runDir = await fs.mkdtemp(path.join(downloadRoot, 'yt-'));

    await runExternalCommand('yt-dlp', [
      '-q', '-P', runDir, '-o', '%(title)s.%(ext)s',
      '-f', 'bestaudio/best',
      '-x', '--audio-format', 'mp3',
      '--no-progress', url
    ]);

    // Buscar el archivo de audio descargado
    const files = await fs.readdir(runDir);
    const audioFile = files.find(f =>
      f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.opus') ||
      f.endsWith('.webm') || f.endsWith('.wav')
    );

    if (!audioFile) {
      throw new errors.HumanError('No se pudo descargar el audio.', {
        tip: 'Verifica que la URL sea válida y el video sea público.'
      });
    }

    const audioPath = path.join(runDir, audioFile);
    const stats = await fs.stat(audioPath);
    ui.debug('Audio downloaded:', audioPath, 'size:', stats.size);

    spin.update('Transcribing with Whisper...');

    // Paso 2: Transcribir con Whisper API
    const transcript = await transcribeMedia({
      openaiClient,
      filePath: audioPath,
      clipRange: options.clipRange,
      config
    });

    spin.success('Done');

    // Paso 3: Mostrar transcript crudo
    console.log('\n' + '─'.repeat(60));
    console.log(transcript);
    console.log('─'.repeat(60) + '\n');

    // Cleanup
    if (!config.keepDownloads) {
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }

    ui.debug('Transcript complete, chars:', transcript.length);

  } catch (error) {
    spin.error('Error');
    errors.show(error, { verbose: options.verbose });
  }
}

// ============ PERSISTENCE ============

async function persistRun({ options, config, results, agentData, rawMode, agentProvider, styleUsed }) {
  try {
    const doc = {
      source: { url: options.url || null, path: options.inputPath || null },
      mode: options.mode || config.mode,
      style: styleUsed || 'bukowski',
      ocrModel: config.ocrModel,
      agentProvider: agentProvider || config.agentProvider,
      agentModel: config.agentModel,
      whisperModel: config.transcribeModel,
      mediaResolution: config.mediaResolution,
      thinkingLevel: config.thinkingLevel,
      promptName: agentData?.promptPath ? path.basename(agentData.promptPath) : null,
      title: sanitizeTitle(agentData?.title) || buildAutoTitle({ results, fallback: options.url || options.inputPath || '' }),
      reflection: agentData?.reflection || null,
      actionPlan: agentData?.plan || null,
      finalResponse: agentData?.finalResponse || null,
      xml: agentData?.xml || null,
      results,
      metadata: { rawMode }
    };

    await saveRun(doc);
    ui.debug('Run persisted');

  } catch (error) {
    ui.debug('Persist error:', error.message);
    // No es fatal, solo debug
  }
}

// ============ CONTEXT ============

async function gatherContextForItems(items) {
  const contextMap = new Map();
  const infoCache = new Map();

  for (const item of items) {
    const absolutePath = path.resolve(item.path);
    const contexts = [];

    // Per-file metadata
    const perFileMeta = await readJSONIfExists(`${absolutePath}.json`);
    if (perFileMeta) {
      const ctx = extractContextText(perFileMeta);
      if (ctx) contexts.push(ctx);
    }

    // Directory metadata
    const dir = path.dirname(absolutePath);
    let dirContext = infoCache.get(dir);
    if (dirContext === undefined) {
      dirContext = await loadInfoContext(dir);
      infoCache.set(dir, dirContext);
    }
    if (dirContext) contexts.push(dirContext);

    if (contexts.length) {
      contextMap.set(absolutePath, contexts.map(c => `[MEDIA_CONTEXT]\n${c}`).join('\n'));
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
    ['tweet_text', 'Texto del tweet'], ['full_text', 'Texto completo'],
    ['text', 'Texto'], ['description', 'Descripción'], ['caption', 'Caption'],
    ['title', 'Título'], ['summary', 'Resumen'], ['content', 'Contenido']
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

async function collectTextFromMetadata(baseDir) {
  const items = [];
  const queue = [baseDir];

  while (queue.length) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { continue; }

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

async function collectTextFromDump(url) {
  const items = [];
  try {
    const stdout = await runCommandCaptureStdout('gallery-dl', ['--dump-json', url]);
    const lines = stdout.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const text = extractPrimaryText(obj);
        if (text) {
          items.push({ path: `${url}#text`, type: 'text', inlineText: text });
          break;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return items;
}

async function collectTextFromFxApi(rawUrl) {
  const info = parseTweetInfo(rawUrl);
  if (!info?.id) return null;

  const apiUrl = info.user
    ? `https://api.fxtwitter.com/${info.user}/status/${info.id}`
    : `https://api.fxtwitter.com/i/status/${info.id}`;

  try {
    const response = await fetch(apiUrl, { headers: { 'user-agent': 'twx-cli' } });
    if (!response.ok) return null;

    const data = await response.json();
    const text = data?.tweet?.raw_text?.text || data?.tweet?.text || data?.text;

    if (typeof text === 'string' && text.trim()) {
      return { path: `${apiUrl}#text`, type: 'text', inlineText: text.trim() };
    }
  } catch { /* skip */ }

  return null;
}

async function collectTextFromRedditUrl(rawUrl, config) {
  const env = {
    REDDIT_CLIENT_ID: config.redditClientId || process.env.REDDIT_CLIENT_ID || '',
    REDDIT_CLIENT_SECRET: config.redditClientSecret || process.env.REDDIT_CLIENT_SECRET || '',
    REDDIT_USER_AGENT: config.redditUserAgent || process.env.REDDIT_USER_AGENT || 'twx-reddit/0.1'
  };

  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    throw new errors.HumanError('Faltan credenciales de Reddit para usar la API oficial.', {
      tip: 'Define REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET en tu .env o ejecuta "twx config".'
    });
  }

  const scriptPath = path.join(PROJECT_ROOT, 'bin', 'fetch_reddit.py');
  let pythonCmd = 'python3';

  try {
    await fs.access(path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'));
    pythonCmd = path.join(PROJECT_ROOT, '.venv', 'bin', 'python3');
  } catch { /* fallback to system python3 */ }

  try {
    const raw = await runExternalCommand(pythonCmd, [scriptPath, rawUrl], { env });
    const data = JSON.parse(raw);
    const chunks = [];
    if (data.title) chunks.push(`Título: ${data.title}`);
    if (data.selftext) chunks.push(`Post:\n${data.selftext}`);
    if (Array.isArray(data.comments) && data.comments.length) {
      const commentBlock = data.comments.map((c, i) => `Comentario ${i + 1}:\n${c}`).join('\n\n');
      chunks.push(commentBlock);
    }
    if (data.subreddit) chunks.push(`Subreddit: ${data.subreddit}`);
    if (data.author) chunks.push(`Autor: ${data.author}`);
    if (data.comment_count != null) chunks.push(`Comentarios totales: ${data.comment_count}`);
    if (!chunks.length) return null;

    return { path: rawUrl, type: 'text', inlineText: chunks.join('\n\n') };
  } catch (error) {
    ui.debug('collectTextFromRedditUrl error:', error.message);
    throw new errors.HumanError('No pude recuperar el post de Reddit usando la API oficial.', {
      tip: 'Verifica que la URL sea pública y que las credenciales de Reddit sean correctas.',
      technical: error.message
    });
  }
}

function extractPrimaryText(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const fields = ['tweet_text', 'full_text', 'text', 'description', 'caption', 'title', 'summary', 'content'];
  for (const key of fields) {
    if (typeof meta[key] === 'string' && meta[key].trim()) {
      return meta[key].trim();
    }
  }
  return '';
}

async function fetchTwitterThread(tweetUrl) {
  const apiUrl = new URL(TWITTER_THREAD_API);
  apiUrl.searchParams.set('tweet_url', tweetUrl);
  apiUrl.searchParams.set('max_tweets', String(TWITTER_THREAD_MAX_TWEETS));

  ui.debug('Fetching Twitter thread from API:', apiUrl.toString());

  let response;
  try {
    response = await fetch(apiUrl.toString(), {
      method: 'GET',
      headers: { 'accept': 'application/json' },
      redirect: 'follow'
    });
  } catch (error) {
    ui.debug('Thread API network error:', error?.message || error);
    throw new errors.HumanError('No pude obtener el hilo completo (API).', {
      tip: 'Verifica la conectividad con el endpoint de thread y reintenta.'
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    ui.debug('Thread API HTTP error:', response.status, body.slice(0, 500));
    throw new errors.HumanError(`El API de hilos devolvió ${response.status}`, {
      tip: 'Revisa que la URL de tweet sea pública o vuelve a intentar más tarde.'
    });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new errors.HumanError('Respuesta inválida del API de hilos.', {
      tip: 'El endpoint no devolvió JSON válido.'
    });
  }

  if (!data?.tweets || !Array.isArray(data.tweets) || !data.tweets.length) {
    throw new errors.HumanError('El API no devolvió tweets para este hilo.', {
      tip: data?.message || 'Asegúrate de usar la URL completa del tweet.'
    });
  }

  const author = data.tweets[0]?.author_handle || data.thread_author || 'autor';
  const parts = data.tweets.map((tweet, idx) => {
    const num = idx + 1;
    const total = data.tweets.length;
    const text = tweet?.text || '';
    const likes = tweet?.likes != null ? `❤️ ${tweet.likes} likes` : '';
    return `Tweet ${num}/${total} @${tweet?.author_handle || author} (${tweet?.author_name || ''}):\n${text}\n${likes}`.trim();
  });

  const inlineText = `HILO COMPLETO (${parts.length} tweets)\n\n${parts.join('\n\n---\n\n')}`;
  return { path: `${tweetUrl}#thread`, type: 'text', inlineText };
}

function parseTweetInfo(rawUrl) {
  try {
    const { hostname, pathname } = new URL(rawUrl);
    if (!TWITTER_HOSTS.has(hostname.toLowerCase())) return null;

    const parts = pathname.split('/').filter(Boolean);
    const statusIndex = parts.findIndex(p => p === 'status' || p === 'statuses');

    if (statusIndex === -1 || !parts[statusIndex + 1]) {
      const id = parts.find(p => /^\d{5,}$/.test(p));
      return id ? { id, user: parts[0] || null } : null;
    }

    return {
      id: parts[statusIndex + 1].split('?')[0],
      user: parts[statusIndex - 1] || null
    };
  } catch {
    return null;
  }
}

// ============ UTILITIES ============

async function runExternalCommand(command, args, options = {}) {
  ui.debug('Executing:', command, args);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ? { ...process.env, ...options.env } : process.env
    });
    let stderr = '';
    let stdout = '';

    child.stderr?.on('data', chunk => stderr += chunk.toString());
    child.stdout?.on('data', chunk => stdout += chunk.toString());

    child.on('error', error => {
      if (error.code === 'ENOENT') {
        reject(new Error(`${command} not found. Install it and make sure it's in your PATH.`));
        return;
      }
      reject(error);
    });

    child.on('exit', code => {
      if (code === 0) {
        ui.debug('Command OK:', command);
        resolve(stdout);
      } else {
        reject(new Error(`${command} failed with code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`));
      }
    });
  });
}

async function runCommandCaptureStdout(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => stdout += chunk.toString());
    child.stderr.on('data', chunk => stderr += chunk.toString());

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed: ${stderr.slice(0, 200)}`));
    });
  });
}

async function safeStat(target) {
  try {
    return await fs.stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJSONIfExists(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function normalizeStyle(value) {
  if (!value) return null;
  const key = value.toLowerCase();
  return STYLE_ALIASES[key] || (STYLE_PRESETS[key] ? key : null);
}

function resolveAgentPromptPath(style) {
  const key = normalizeStyle(style) || 'bukowski';
  if (key === 'bukowski') return AGENT_PROMPT_BUKOWSKI_PATH;
  return AGENT_PROMPT_MUSK_PATH;
}

function extractResponseText(response, provider = 'gemini') {
  if (!response) return '';
  if (provider === 'claude') {
    const parts = response.content || [];
    return parts
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p?.text) return p.text;
        if (p?.type === 'text') return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof response.text === 'function') return response.text();
  if (typeof response.text === 'string') return response.text;
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p.text).filter(Boolean).join('\n');
}

function extractResponseBlock(text) {
  if (!text) return '';
  const start = text.indexOf('<response');
  const end = text.lastIndexOf('</response>');
  if (start === -1 || end === -1) return '';
  return text.slice(start, end + '</response>'.length).trim();
}

function extractTag(xml, tag) {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(pattern);
  return match ? match[1].trim() : '';
}

function stripXmlTags(text) {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '');
}

function sanitizeTitle(title) {
  if (!title) return '';
  return title.split('\n').map(l => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}

function parseTimecode(value) {
  if (!value && value !== 0) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const parts = trimmed.split(':').map(p => p.trim()).filter(Boolean);
  if (!parts.length || parts.some(p => isNaN(Number(p)))) return null;

  const nums = parts.map(Number);
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 1) return nums[0];
  return null;
}

// ============ ARGS ============

function parseArgs(argv) {
  const options = {
    inputPath: null,
    url: null,
    json: false,
    recursive: true,
    style: null,
    styleFile: null,
    styleText: null,
    mode: null,
    verbose: false,
    list: false,
    listLimit: 10,
    modelCommand: false,
    modelValue: null,
    showId: null,
    directive: null,
    thread: false,
    clipStart: null,
    clipEnd: null,
    clipRange: null,
    showTranscript: false,
    configCommand: false,
    configReset: false,
    configShow: false,
    transcriptOnly: false
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Transcript command (debe ir antes de otros checks)
    if (arg === 'transcript' || arg === 'transcribe' || arg === 'trans') {
      options.transcriptOnly = true;
      continue;
    }

    // Config command
    if (arg === 'config') {
      options.configCommand = true;
      continue;
    }
    if (arg === '--reset') {
      options.configReset = true;
      continue;
    }

    // List/History
    if (arg === 'list' || arg === 'history' || arg === '--list' || arg === '-l') {
      options.list = true;
      continue;
    }

    // Model command
    if (arg === 'model' || arg === 'setmodel' || arg === 'provider') {
      options.modelCommand = true;
      options.modelValue = argv[++i] || null;
      continue;
    }

    // Show
    if (arg === 'show' || arg === 'view' || arg === '--show') {
      options.showId = argv[++i] || null;
      continue;
    }

    // Standard flags
    if (arg === '--path' || arg === '-p') { options.inputPath = argv[++i]; continue; }
    if (arg === '--url' || arg === '-u') { options.url = argv[++i]; continue; }
    if (arg === '--limit') { options.listLimit = Number(argv[++i]) || 10; continue; }
    if (arg === '--json') { options.json = true; continue; }
    if (arg === '--no-recursive') { options.recursive = false; continue; }
    if (arg === '--style') { options.style = argv[++i]; continue; }
    if (arg === '--style-file') { options.styleFile = argv[++i]; continue; }
    if (arg === '--style-text') { options.styleText = argv[++i]; continue; }
    if (arg === '--verbose' || arg === '--debug') { options.verbose = true; continue; }
    if (arg === '--transcript' || arg === '--show-transcript') { options.showTranscript = true; continue; }
    if (arg === '--thread') { options.thread = true; continue; }
    if (arg === '--help' || arg === '-h') { showUsage(); process.exit(0); }

    // Clip flags
    if (arg === '--clip' || arg === '--range') {
      const val = argv[++i];
      if (val) {
        const [startRaw, endRaw] = val.split(/[-–]/);
        options.clipStart = parseTimecode(startRaw);
        if (endRaw) options.clipEnd = parseTimecode(endRaw);
      }
      continue;
    }
    if (arg === '--start' || arg === '--from') { options.clipStart = parseTimecode(argv[++i]); continue; }
    if (arg === '--end' || arg === '--to') { options.clipEnd = parseTimecode(argv[++i]); continue; }

    // Unknown flag
    if (arg.startsWith('-')) {
      continue; // Ignore unknown
    }

    // Positional
    positional.push(arg);
  }

  // Build clip range
  if (options.clipStart != null || options.clipEnd != null) {
    options.clipRange = {
      start: options.clipStart ?? 0,
      end: options.clipEnd ?? null
    };
  }

  // Handle positional args
  if (options.list) {
    const num = positional.find(v => /^\d+$/.test(v));
    if (num) options.listLimit = Number(num);
    return options;
  }

  if (positional.length > 0) {
    const first = positional[0];

    // Check if it's a MongoDB ObjectId (24 hex chars)
    if (/^[a-f0-9]{24}$/i.test(first)) {
      options.showId = first;
      return options;
    }

    // Check if URL or path
    if (/^https?:\/\//i.test(first)) {
      options.url = first;
    } else {
      options.inputPath = first;
    }
  }

  if (positional.length > 1 && !options.style) {
    const maybeStyle = normalizeStyle(positional[1]);
    if (maybeStyle) {
      options.style = maybeStyle;
    } else {
      options.directive = positional[1];
    }
  } else if (positional.length > 1 && !options.directive) {
    options.directive = positional[1];
  }

  if (positional.length > 2 && !options.directive) {
    options.directive = positional[2];
  }

  return options;
}

function showUsage() {
  console.log(`
  twx

  Paste a URL. Get the insight. Chat with your ideas.

  USAGE
    twx                         Open library (browse & chat with saved ideas)
    twx <url>                   Analyze: Twitter, YouTube, any URL
    twx <url> "<directive>"     Add optional directive for the model
    twx <url> --thread          Extract full Twitter thread via API
    twx <url> transcript        Get raw transcript (yt-dlp + Whisper)
    twx <path>                  Analyze local files
    twx list                    Show history
    twx config                  Setup API keys
    twx setmodel opus           Switch AI provider (gemini|opus|claude)

  LIBRARY (twx without arguments)
    ↑↓        Navigate (max 10 shown, favorites first)
    Enter     Open idea & chat
    🔍        Search option appears if you have 10+ ideas
    Ctrl+C    Exit

  CHAT WITH AN IDEA
    1. Run: twx
    2. Select idea (★ favorites at top)
    3. View insight + previous conversations
    4. Type question, Enter to send (empty = return to list)
    5. AI responds with full context
    6. Saved automatically. Return to list when done.

    (3) = 3 messages in conversation
    ★ = favorite

  TRANSCRIPT
    twx <youtube-url> transcript                    Download + Whisper transcription
    twx <youtube-url> transcript --clip 0:30-2:00   Only a segment

  STYLES
    twx <url> bukowski          Charles Bukowski voice (default)
    twx <url> musk              Elon Musk voice (alias: elon, m, mx)

  OPTIONS
    --clip 0:30-2:00            Video segment
    --thread                    Extract full Twitter thread
    --verbose                   Show technical details

  EXAMPLES
    twx                                             # Open library, chat with ideas
    twx https://x.com/user/status/123456            # Analyze tweet
    twx https://x.com/user/status/123456 --thread   # Analyze full thread
    twx https://youtube.com/watch?v=abc             # Analyze YouTube video
    twx https://youtube.com/watch?v=abc transcript  # Just transcribe
    twx https://youtube.com/watch?v=abc --clip 1:00-5:00
    twx ./screenshots/ bukowski

`);
}

// ============ RUN ============

main().catch(error => {
  errors.show(error, { verbose: process.argv.includes('--verbose') });
  process.exit(1);
});
