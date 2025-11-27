#!/usr/bin/env node
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import ora from 'ora';
import { PDFDocument } from 'pdf-lib';
import { saveRun, listRuns, buildAutoTitle, getRunById } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt.txt');
const LONG_AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt_long.txt');
const TOP_AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt_top.txt');
const DEFAULT_SESSION_LOG = path.join(PROJECT_ROOT, 'current_session.txt');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const DEFAULT_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3-pro-preview';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const DEFAULT_AGENT_MODEL = process.env.GEMINI_AGENT_MODEL || 'gemini-3-pro-preview';
const DEFAULT_AGENT_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_AGENT_MAX_OUTPUT_TOKENS ?? 64000);
const DEFAULT_THINKING_LEVEL = normalizeThinkingLevel(process.env.GEMINI_THINKING_LEVEL) || 'HIGH';
const DEFAULT_MEDIA_RESOLUTION =
  normalizeMediaResolution(process.env.GEMINI_MEDIA_RESOLUTION) || 'MEDIA_RESOLUTION_HIGH';
const DOWNLOAD_ROOT =
  process.env.GEMINI_OCR_DOWNLOAD_ROOT ||
  process.env.OPENAI_OCR_DOWNLOAD_ROOT ||
  path.join(process.cwd(), 'gallery-dl-runs');
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || null;
const MISTRAL_ORG_ID =
  process.env.MISTRAL_ORG_ID || process.env.MISTRAL_ORGANIZATION || process.env.MISTRAL_ORG || null;
const MISTRAL_OCR_MODEL = process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest';
const MAX_INLINE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_WHISPER_FILE_BYTES = 25 * 1024 * 1024;
const WHISPER_SEGMENT_SECONDS = clampInt(
  process.env.WHISPER_SEGMENT_SECONDS || process.env.TWX_SEGMENT_SECONDS,
  60,
  1200,
  480
);
const WHISPER_TARGET_BITRATE = process.env.WHISPER_AUDIO_BITRATE || '48k';
const WHISPER_TARGET_SAMPLE_RATE = process.env.WHISPER_SAMPLE_RATE || '16000';
const SPINNER_ENABLED = process.stdout.isTTY && process.env.TWX_NO_SPINNER !== '1';
let DEBUG_ENABLED = process.env.TWX_DEBUG === '1';
const DEFAULT_MODE = (process.env.TWX_MODE || 'standard').toLowerCase();

function debugLog(...args) {
  if (DEBUG_ENABLED) {
    console.log('[DEBUG]', ...args);
  }
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return Math.min(Math.max(Math.round(num), min), max);
  }
  return fallback;
}

const IMAGE_MIME_TYPES = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
};

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.m4v']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.rtf']);

const STYLE_PRESETS = {
  musk:
    'Resumí en español con la voz de Elon Musk: frases cortas, tono técnico y enfoque en próximos pasos y apuestas audaces.',
  bukowski:
    'Resumí en español como Charles Bukowski: crudo, directo, sin adornos pero con acciones claras.',
  raw: 'Devuelve el texto original sin resumir ni comentar.',
  brief: 'Armá un brief ejecutivo en tres viñetas con las ideas más filosas, siempre en español.'
};

const STYLE_ALIASES = {
  m: 'musk',
  mx: 'musk',
  max: 'musk',
  elon: 'musk',
  musk: 'musk',
  buk: 'bukowski',
  bukowski: 'bukowski',
  bk: 'bukowski',
  raw: 'raw',
  plain: 'raw',
  txt: 'raw',
  brief: 'brief',
  sum: 'brief'
};

const TWITTER_HOSTS = new Set(['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'mobile.twitter.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const SPINNER_STUB = {
  set text(value) {
    this._text = value;
  },
  succeed() {},
  fail() {},
  stop() {},
  info() {}
};

function startSpinner(text) {
  if (!SPINNER_ENABLED) {
    const stub = Object.create(SPINNER_STUB);
    stub._text = text;
    return stub;
  }
  return ora({ text, color: 'cyan' }).start();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.debug) {
    DEBUG_ENABLED = true;
  }
  debugLog('Options:', options);
  if (options.list) {
    await handleListCommand(options);
    return;
  }
  if (options.showId) {
    await handleShowCommand(options.showId);
    return;
  }
  if (!options.inputPath && !options.url) {
    exitWithUsage('Provide --path or --url.');
  }

  const geminiKey = GEMINI_API_KEY;
  const mistralKey = MISTRAL_API_KEY;
  if (!mistralKey) {
    exitWithUsage('Falta MISTRAL_API_KEY para OCR con Mistral.');
  }
  logRunInfo(options);

  const openaiKey = OPENAI_API_KEY;
  if (!openaiKey) {
    console.warn('Falta OPENAI_API_KEY; no se podrán transcribir audios/videos con Whisper.');
  }

  const geminiClient = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
  const openaiClient = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
  const mediaItems = [];

  if (options.inputPath) {
    const stats = await safeStat(options.inputPath);
    if (!stats) {
      exitWithUsage(`Ruta de entrada no encontrada: ${options.inputPath}`);
    }

    if (stats.isDirectory()) {
      const collected = await collectMedia(options.inputPath, { recursive: options.recursive });
      mediaItems.push(...collected);
      debugLog('Media found in directory:', collected.map((item) => item.path));
    } else {
      const type = getMediaType(options.inputPath);
      if (!type) {
        exitWithUsage(`Tipo de archivo no soportado: ${options.inputPath}`);
      }
      mediaItems.push({ path: options.inputPath, type });
      debugLog('Single file detected:', options.inputPath, 'type:', type);
    }
  }

  if (options.url) {
    const download = await downloadRemoteMedia(options.url);
    if (!download.items.length) {
      exitWithUsage(`No se descargaron medios compatibles desde: ${options.url}`);
    }
    mediaItems.push(...download.items);
    debugLog('Media downloaded from URL:', options.url, download.items.map((item) => item.path));
  }

  if (!mediaItems.length) {
    exitWithUsage('No hay medios compatibles para procesar.');
  }

  const contextMap = await gatherContextForItems(mediaItems);

  const results = [];

  for (const item of mediaItems) {
    const absolutePath = path.resolve(item.path);
    const relativePath = path.relative(process.cwd(), absolutePath) || absolutePath;
    const spinner = startSpinner(`processing ${item.type} · ${path.basename(relativePath)}`);
    debugLog('Processing media', relativePath, 'type', item.type);
    try {
      let text = '';
      if (item.type === 'image') {
        text = await extractTextFromImage({
          filePath: absolutePath
        });
      } else if (item.type === 'video' || item.type === 'audio') {
        text = await transcribeMedia({ openaiClient, filePath: absolutePath });
      } else if (item.type === 'text') {
        text = await readPlainText(absolutePath, item.inlineText);
      } else {
        throw new Error(`Tipo de medio no soportado: ${relativePath}`);
      }

      const context = contextMap.get(absolutePath) || null;
      results.push({ file: relativePath, type: item.type, text, context });
      debugLog('Text obtained', { file: relativePath, type: item.type, preview: text.slice(0, 120) });
      spinner.succeed(`done ${path.basename(relativePath)}`);
      if (!options.json) {
        logResult({ file: relativePath, type: item.type }, text, context);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const context = contextMap.get(absolutePath) || null;
      results.push({ file: relativePath, type: item.type, error: message, context });
      debugLog('Error processing', relativePath, message);
      spinner.fail(`error ${path.basename(relativePath)}`);
      if (!options.json) {
        console.error(`\nerror · ${relativePath}`);
        console.error(`        ${message}`);
      }
    }
  }

  if (options.json || options.outputFile) {
    const payload = JSON.stringify(
      {
        vision_model: DEFAULT_VISION_MODEL,
        transcription_model: DEFAULT_TRANSCRIBE_MODEL,
        mode: options.mode,
        results
      },
      null,
      2
    );
    if (options.outputFile) {
      await fs.writeFile(options.outputFile, payload, 'utf8');
      if (!options.json) {
        console.log(`\nresults saved to ${options.outputFile}`);
      }
      debugLog('JSON saved to', options.outputFile);
    }
    if (options.json) {
      console.log(payload);
      debugLog('JSON written to stdout');
    }
  }

  const normalizedStyle = normalizeStyle(options.style);
  const hasCustomStyleInput = Boolean(options.styleFile || options.styleText);
  const rawMode = normalizedStyle === 'raw' && !hasCustomStyleInput;
  debugLog('Normalized style:', normalizedStyle, 'rawMode:', rawMode);

  if (rawMode) {
    const combined = results
      .filter((entry) => entry.text)
      .map((entry) => `### ${entry.file}\n${entry.text}`)
      .join('\n\n');
    if (combined) {
      console.log('\n--- RAW TRANSCRIPTS (no GPT) ---');
      console.log(combined);
      debugLog('Raw mode enabled, combined chars:', combined.length);
    }
  }

  const shouldRunAgent = Boolean(
    !rawMode &&
      (options.style || options.styleFile || options.styleText) &&
      results.some((entry) => entry.text)
  );
  debugLog('Should run agent?', shouldRunAgent);

  let conversationHistory = [];
  let agentData = null;

  if (shouldRunAgent && !geminiClient) {
    console.warn('\n⚠️ Agent solicitado pero falta GEMINI_API_KEY/GOOGLE_API_KEY; se omite el paso de insights.');
  } else if (shouldRunAgent) {
    const { history, agentData: seedAgentData } = await runInsightAgent({
      client: geminiClient,
      results,
      style: options.style,
      styleFile: options.styleFile,
      styleText: options.styleText,
      showReflection: options.showReflection,
      sessionLog: options.sessionLog,
      agentPromptPath: resolveAgentPromptPath(options.mode, options.agentPromptPath),
      debug: DEBUG_ENABLED
    });
    conversationHistory = history || [];
    agentData = seedAgentData || null;
  }

  await persistRun({
    options,
    results,
    agentData,
    promptPath: resolveAgentPromptPath(options.mode, options.agentPromptPath),
    rawMode,
    shouldRunAgent
  });

  if (
    shouldRunAgent &&
    geminiClient &&
    supportsInteractivePrompts() &&
    !options.json &&
    !rawMode &&
    results.some((entry) => entry.text)
  ) {
    await startConversationLoop({
      client: geminiClient,
      results,
      options,
      conversationHistory,
      agentPromptPath: resolveAgentPromptPath(options.mode, options.agentPromptPath)
    });
  }
}

async function extractTextFromImage({ filePath }) {
  if (!MISTRAL_API_KEY) {
    throw new Error('Falta MISTRAL_API_KEY para OCR con Mistral.');
  }

  const extension = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[extension] || 'image/png';
  const buffer = await fs.readFile(filePath);
  if (buffer.length > MAX_INLINE_FILE_BYTES) {
    throw new Error(
      `Imagen demasiado grande para Mistral (${Math.round(buffer.length / (1024 * 1024))}MB). Comprimila a <20MB.`
    );
  }

  const pdfBuffer = await imageToPdfBuffer(buffer, mimeType);
  const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;

  const headers = {
    Authorization: `Bearer ${MISTRAL_API_KEY}`,
    'Content-Type': 'application/json'
  };
  if (MISTRAL_ORG_ID) {
    headers['Mistral-Organization'] = MISTRAL_ORG_ID;
  }

  const body = {
    model: MISTRAL_OCR_MODEL,
    document: { type: 'document_url', document_url: dataUrl }
  };

  debugLog('Calling Mistral OCR with file', filePath, 'bytes', buffer.length, 'pdfBytes', pdfBuffer.length);
  const started = Date.now();
  const response = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  debugLog('Mistral OCR response', {
    status: response.status,
    statusText: response.statusText,
    elapsed: Date.now() - started,
    rawPreview: raw.slice(0, 200)
  });
  if (!response.ok) {
    throw new Error(`Mistral OCR falló: ${response.status} ${response.statusText} body=${raw.slice(0, 400)}`);
  }
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Respuesta OCR no es JSON: ${error instanceof Error ? error.message : error}`);
  }
  const text = extractMistralOcrText(data);
  if (!text) {
    throw new Error('OCR de Mistral no devolvió texto.');
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
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: embedded.width,
    height: embedded.height
  });
  return Buffer.from(await pdfDoc.save());
}

function extractMistralOcrText(data) {
  const parts = [];
  const pages = data?.result?.pages || data?.pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      const text = page?.text || page?.output_text || page?.content || page?.markdown;
      if (text) {
        parts.push(String(text));
      }
    }
  }
  if (data?.output_text) parts.push(String(data.output_text));
  if (data?.text) parts.push(String(data.text));
  if (data?.result?.text) parts.push(String(data.result.text));
  return parts
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function transcribeMedia({ openaiClient, filePath }) {
  if (!openaiClient) {
    throw new Error('Falta OPENAI_API_KEY para transcribir audio/video con Whisper.');
  }
  const prepared = await prepareAudioForWhisper(filePath);
  const segmented = await splitAudioIfNeeded(prepared.path);

  const cleanupTasks = [prepared.cleanup, segmented.cleanup].filter(Boolean);
  const parts = [];

  try {
    for (const segmentPath of segmented.paths) {
      const stream = createReadStream(segmentPath);
      const response = await openaiClient.audio.transcriptions.create({
        model: DEFAULT_TRANSCRIBE_MODEL,
        file: stream,
        response_format: 'text'
      });
      if (!response) {
        throw new Error(`Empty transcription for ${segmentPath}`);
      }
      const text = typeof response === 'string' ? response : response.text;
      debugLog('Whisper transcription captured', { filePath: segmentPath, chars: text?.length || 0 });
      if (text && text.trim()) {
        parts.push(text.trim());
      }
    }
  } finally {
    for (const cleanup of cleanupTasks) {
      if (cleanup) {
        await cleanup();
      }
    }
  }

  if (!parts.length) {
    throw new Error(`No transcription text produced for ${filePath}`);
  }

  return parts.join('\n\n');
}

async function readPlainText(filePath, inlineText = null) {
  if (inlineText) {
    return String(inlineText).trim();
  }
  const data = await fs.readFile(filePath, 'utf8');
  return data.trim();
}

async function prepareAudioForWhisper(filePath) {
  const stats = await fs.stat(filePath);
  if (stats.size <= MAX_WHISPER_FILE_BYTES) {
    return { path: filePath, cleanup: null };
  }

  console.log('\ncompressing media for whisper…');
  return transcodeForWhisper(filePath);
}

async function transcodeForWhisper(filePath) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-audio-'));
  const basename = path.basename(filePath, path.extname(filePath));
  const targetPath = path.join(tmpDir, `${basename}-twx.m4a`);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    WHISPER_TARGET_SAMPLE_RATE,
    '-b:a',
    WHISPER_TARGET_BITRATE,
    targetPath
  ];

  try {
    await runExternalCommand('ffmpeg', args, { stdio: 'inherit' });
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      'ffmpeg es requerido para comprimir medios >25MB antes de Whisper. Instalalo o comprimí el archivo manualmente.'
    );
  }

  return {
    path: targetPath,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

async function splitAudioIfNeeded(filePath) {
  const stats = await fs.stat(filePath);
  if (stats.size <= MAX_WHISPER_FILE_BYTES) {
    return { paths: [filePath], cleanup: null };
  }

  console.log(`\nsplitting audio into ~${Math.round(WHISPER_SEGMENT_SECONDS / 60)} min chunks for whisper…`);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-chunks-'));
  const pattern = path.join(tmpDir, 'chunk-%03d.m4a');
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    WHISPER_TARGET_SAMPLE_RATE,
    '-b:a',
    WHISPER_TARGET_BITRATE,
    '-f',
    'segment',
    '-segment_time',
    String(WHISPER_SEGMENT_SECONDS),
    pattern
  ];

  await runExternalCommand('ffmpeg', args, { stdio: 'inherit' });

  const entries = await fs.readdir(tmpDir);
  const paths = entries
    .filter((name) => name.startsWith('chunk-') && name.endsWith('.m4a'))
    .map((name) => path.join(tmpDir, name))
    .sort();

  if (!paths.length) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('No se generaron segmentos de audio para Whisper.');
  }

  for (const chunkPath of paths) {
    const chunkStats = await fs.stat(chunkPath);
    if (chunkStats.size > MAX_WHISPER_FILE_BYTES) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new Error(
        `Un segmento aún supera 25MB (${Math.round(chunkStats.size / (1024 * 1024))}MB). Bajá WHISPER_SEGMENT_SECONDS o WHISPER_AUDIO_BITRATE.`
      );
    }
  }

  return {
    paths,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

async function downloadRemoteMedia(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (YOUTUBE_HOSTS.has(hostname)) {
    return downloadWithYtDlp(url);
  }
  if (TWITTER_HOSTS.has(hostname)) {
    return downloadWithGalleryDl(url);
  }
  return downloadWithGalleryDl(url);
}

async function downloadWithGalleryDl(url) {
  await fs.mkdir(DOWNLOAD_ROOT, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(DOWNLOAD_ROOT, 'run-'));
  debugLog('Downloading with gallery-dl into', runDir, 'url', url);
  await runGalleryDl(url, runDir);
  const items = await collectMedia(runDir, { recursive: true });
  debugLog('Files captured by gallery-dl:', items.map((item) => item.path));
  if (!items.length) {
    const textItems = await collectTextFromMetadata(runDir);
    if (!textItems.length) {
      const dumpTextItems = await collectTextFromDump(url);
      textItems.push(...dumpTextItems);
    }
    if (!textItems.length) {
      const fxTextItem = await collectTextFromFxApi(url);
      if (fxTextItem) {
        textItems.push(fxTextItem);
      }
    }
    if (textItems.length) {
      debugLog('Text-only tweet detected; creating virtual text item from metadata.');
      items.push(...textItems);
    }
  }
  return { baseDir: runDir, items };
}

async function downloadWithYtDlp(url) {
  await fs.mkdir(DOWNLOAD_ROOT, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(DOWNLOAD_ROOT, 'yt-'));
  const args = [
    '-q',
    '-P',
    runDir,
    '-o',
    '%(title)s.%(ext)s',
    '-f',
    'bestaudio/best',
    '--no-progress',
    '--write-info-json',
    url
  ];
  debugLog('Downloading with yt-dlp into', runDir, 'url', url, 'args', args);
  await runExternalCommand('yt-dlp', args);
  const items = await collectMedia(runDir, { recursive: true });
  debugLog('Files captured by yt-dlp:', items.map((item) => item.path));
  return { baseDir: runDir, items };
}

async function runGalleryDl(url, baseDir) {
  const args = ['--quiet', '--write-info-json', '--write-metadata', '-d', baseDir, url];
  await runExternalCommand('gallery-dl', args);
}

async function runGalleryDlDump(url) {
  debugLog('Running gallery-dl dump for text extraction', url);
  const args = ['--dump-json', url];
  const stdout = await runCommandCaptureStdout('gallery-dl', args);
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const objects = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      objects.push(obj);
    } catch (error) {
      debugLog('Failed to parse gallery-dl dump line:', error);
    }
  }
  return objects;
}

async function runExternalCommand(command, args, { stdio = 'inherit' } = {}) {
  debugLog('Executing command:', command, args);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio });
    child.on('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        reject(new Error(`${command} not found. Install it and ensure it is on your PATH.`));
        return;
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        debugLog('Command finished OK:', command);
        resolve();
      } else {
        reject(new Error(`${command} exited with status ${code}`));
      }
    });
  });
}

async function runCommandCaptureStdout(command, args) {
  debugLog('Executing command (capture stdout):', command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        debugLog('Command finished OK:', command);
        resolve(stdout);
      } else {
        reject(new Error(`${command} exited with status ${code}${stderr ? ` stderr=${stderr.slice(0, 400)}` : ''}`));
      }
    });
  });
}

async function collectMedia(targetPath, { recursive }) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isFile()) {
      const type = getMediaType(entryPath);
      if (type) {
        items.push({ path: entryPath, type });
      }
    } else if (recursive && entry.isDirectory()) {
      const subItems = await collectMedia(entryPath, { recursive });
      items.push(...subItems);
    }
  }

  debugLog('collectMedia', targetPath, '->', items.length, 'items');

  return items;
}

async function collectTextFromMetadata(baseDir) {
  const items = [];
  const queue = [baseDir];
  let metaPath = null;
  let metaData = null;

  while (queue.length) {
    const dir = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      debugLog('collectTextFromMetadata readdir error:', error);
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
        if (meta && typeof meta === 'object') {
          metaPath = entryPath;
          metaData = meta;
          break;
        }
      }
    }
    if (metaData) {
      break;
    }
  }

  if (!metaData) {
    return items;
  }

  const text = extractPrimaryText(metaData);
  if (!text) {
    return items;
  }

  items.push({
    path: metaPath || path.join(baseDir, 'tweet.txt'),
    type: 'text',
    inlineText: text
  });
  return items;
}

async function collectTextFromDump(url) {
  const items = [];
  let dumpObjects = [];
  try {
    dumpObjects = await runGalleryDlDump(url);
  } catch (error) {
    debugLog('collectTextFromDump error:', error);
    return items;
  }
  for (const obj of dumpObjects) {
    const text = extractPrimaryText(obj);
    if (text) {
      items.push({
        path: `${url}#text`,
        type: 'text',
        inlineText: text
      });
      break;
    }
  }
  return items;
}

async function collectTextFromFxApi(rawUrl) {
  const info = parseTweetInfo(rawUrl);
  if (!info?.id) {
    return null;
  }
  const apiUrl = info.user
    ? `https://api.fxtwitter.com/${info.user}/status/${info.id}`
    : `https://api.fxtwitter.com/i/status/${info.id}`;
  try {
    debugLog('Fetching text via fxtwitter API', apiUrl);
    const response = await fetch(apiUrl, {
      headers: { 'user-agent': 'twx-cli' }
    });
    if (!response.ok) {
      debugLog('fxtwitter API failed', response.status, response.statusText);
      return null;
    }
    const data = await response.json();
    const text =
      data?.tweet?.raw_text?.text ||
      data?.tweet?.text ||
      data?.tweet?.content ||
      data?.raw_text?.text ||
      data?.text;
    if (typeof text === 'string' && text.trim()) {
      return { path: `${apiUrl}#text`, type: 'text', inlineText: text.trim() };
    }
    return null;
  } catch (error) {
    debugLog('collectTextFromFxApi error:', error);
    return null;
  }
}

function getMediaType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(IMAGE_MIME_TYPES, extension)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return 'audio';
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }
  return null;
}

async function runInsightAgent({
  client,
  results,
  style,
  styleFile,
  styleText,
  showReflection,
  sessionLog,
  agentPromptPath
}) {
  const promptPath = agentPromptPath ? path.resolve(agentPromptPath) : AGENT_PROMPT_PATH;
  const promptSource = await fs.readFile(promptPath, 'utf8');

  const normalizedStyle = normalizeStyle(style);
  const preset = normalizedStyle && STYLE_PRESETS[normalizedStyle];
  const inlineCustom = !normalizedStyle && style ? style : '';
  const customStyle = styleText
    ? styleText
    : styleFile
      ? await fs.readFile(path.resolve(styleFile), 'utf8')
      : inlineCustom;

  const result = await generateAgentResponse({
    client,
    promptSource,
    results,
    normalizedStyle,
    preset,
    customStyle,
    conversationHistory: [],
    spinnerLabel: 'generating…',
    showSpacer: true
  });

  if (!result || !result.finalResponse) {
    return { history: [], agentData: null };
  }

  const { reflection, plan, finalResponse, title, xml, historyAppend = [] } = result;

  printFinalResponse(finalResponse);

  await handleReflectionOutput({
    reflection,
    xml,
    planText: plan?.trim() ?? '',
    responseText: finalResponse?.trim() ?? '',
    showReflection,
    sessionLog
  });

  return {
    history: finalResponse ? historyAppend.slice() : [],
    agentData: { reflection, plan, finalResponse, title, xml, promptPath }
  };
}

async function generateAgentResponse({
  client,
  promptSource,
  results,
  normalizedStyle,
  preset,
  customStyle,
  conversationHistory = [],
  spinnerLabel = 'generating…',
  showSpacer = false
}) {
  let response = null;
  let omitContext = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = buildAgentPayload({
      results,
      styleKey: normalizedStyle,
      preset,
      customStyle,
      omitContext,
      conversationHistory
    });
    debugLog('Payload sent to agent:\n' + payload);

    if (attempt === 0 && showSpacer) {
      console.log('');
    }
    const spinner = startSpinner(attempt === 0 ? spinnerLabel : 'retrying…');

    try {
      const userContent = {
        role: 'user',
        parts: [{ text: payload }]
      };
      const contents = [...conversationHistory, userContent];
      response = await client.models.generateContent({
        model: DEFAULT_AGENT_MODEL,
        contents,
        systemInstruction: {
          parts: [{ text: promptSource }]
        },
        config: {
          maxOutputTokens: DEFAULT_AGENT_MAX_OUTPUT_TOKENS,
          temperature: 1,
          thinkingLevel: DEFAULT_THINKING_LEVEL,
          mediaResolution: DEFAULT_MEDIA_RESOLUTION
        }
      });
      spinner.succeed(attempt === 0 ? 'plan ready' : 'retry succeeded');
      const assistantContent = response?.candidates?.[0]?.content || null;
      response = { response, userContent, assistantContent };
      break;
    } catch (error) {
      spinner.fail('plan generation failed');
      if (isInvalidPromptError(error) && !omitContext) {
        console.warn('Prompt was flagged; retrying with captions trimmed.');
        omitContext = true;
        continue;
      }
      debugLog('Agent error:', error);
      throw error;
    }
  }

  if (!response) {
    throw new Error('Agent did not return a response.');
  }

  debugLog('Raw agent response:', safeStringify(response.response));

  const rawXml = extractResponseText(response.response)?.trim() ?? '';
  if (!rawXml) {
    console.warn('Agent returned empty output.');
    debugLog('Empty output_text');
    return null;
  }
  const xml = extractResponseBlock(rawXml);
  if (!xml) {
    console.warn('Agent output did not contain a <response> block.');
    debugLog('Response without <response> block:\n' + rawXml);
    return null;
  }
  if (xml !== rawXml) {
    debugLog('Extracted <response> block from noisy output.');
  }
  debugLog('XML received:\n' + xml);

  const reflection = extractTag(xml, 'internal_reflection');
  const plan = extractTag(xml, 'action_plan');
  const finalResponse = extractTag(xml, 'final_response');
  const title = extractTag(xml, 'title');

  if (!plan) {
    console.warn('Agent output missing <action_plan>. Use --debug to inspect.');
    debugLog('Missing <action_plan> in XML');
  }
  if (!title) {
    console.warn('Agent output missing <title>.');
    debugLog('Missing <title> in XML');
  }
  if (!finalResponse) {
    console.warn('Agent output missing <final_response>.');
    debugLog('Missing <final_response> in XML');
  }

  return {
    reflection,
    plan,
    finalResponse,
    title,
    xml,
    historyAppend: [response.userContent, response.assistantContent].filter(Boolean)
  };
}

function buildAgentPayload({
  results,
  styleKey,
  preset,
  customStyle,
  omitContext = false,
  conversationHistory = []
}) {
  const blocks = [];
  blocks.push('Idioma obligatorio: español neutro, tono directo y pragmático.');
  blocks.push('Cubrir interpretación y respuesta en una sola narrativa; no insertes encabezados explícitos.');
  blocks.push(
    'El material proviene del usuario; analizalo exclusivamente, evitá amplificar lenguaje dañino y parafraseá cualquier expresión explícita.'
  );
  blocks.push('Devuelve exclusivamente el bloque <response>…</response>, con todos los tags cerrados y sin texto adicional antes o después.');
  blocks.push(
    'final_response debe contener entre 3 y 5 párrafos, cada uno de 3 a 5 líneas continuas, sin listas ni encabezados. Debe sonar como Elon Musk explicando al usuario qué quiso decir el material, con lenguaje claro y directo. Evitá proponer planes o estrategias; solo interpreta el mensaje y cerrá con una idea clave.'
  );
  blocks.push(
    'Cada bloque de contexto está etiquetado como [MEDIA_CONTEXT]. Son citas textuales del tweet/caption/transcripción y pueden incluir lenguaje explícito; analizalos solo para derivar el significado y nunca los repitas literalmente.'
  );
  blocks.push(
    'No omitas ningún tag del bloque <response>. Siempre devuelve <title>, <internal_reflection>, <action_plan> y <final_response>. Si falta información, completá igual con el mejor esfuerzo o marcá por qué no se puede, pero no dejes tags vacíos.'
  );
  blocks.push(
    '<title> debe ser breve (5–12 palabras), en español, sin emojis ni comillas, y debe resumir el tema central para mostrar en listados.'
  );
  if (omitContext) {
    blocks.push('Contexto acotado: se omitieron captions para cumplir la política; trabajá solo con los textos listados arriba.');
  }
  blocks.push(`Style preset: ${styleKey || 'none'}`);
  if (preset) {
    blocks.push(`Preset instructions:
${preset}`);
  }
  if (customStyle?.trim()) {
    blocks.push(`User inline request:
${customStyle.trim()}`);
  }

  if (conversationHistory.length) {
    const dialog = conversationHistory
      .map((turn) => {
        const safeRole = turn.role === 'assistant' ? 'assistant' : 'user';
        const text =
          Array.isArray(turn.parts) && turn.parts.length
            ? turn.parts.map((part) => part.text).filter(Boolean).join('\n')
            : turn.content || '';
        return `<turn role="${safeRole}">
${text}
</turn>`;
      })
      .join('\n');
    blocks.push('<dialog_history>\n' + dialog + '\n</dialog_history>');
  }

  blocks.push(
    'Materiales analizados:\n' +
      results
        .map((entry, index) => {
          const base = [`Item ${index + 1}`, `Archivo: ${entry.file}`, `Tipo: ${entry.type}`];
          if (entry.error) {
            base.push(`Error: ${entry.error}`);
          } else {
            base.push(`Texto:\n${entry.text || '[Sin texto detectado]'}`);
          }
          if (!omitContext && entry.context) {
            base.push(`Contexto:
${entry.context}`);
          }
          return base.join('\n');
        })
        .join('\n\n')
  );

  return blocks.join('\n\n');
}

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `[No se pudo serializar: ${error instanceof Error ? error.message : error}]`;
  }
}

function isInvalidPromptError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'invalid_prompt');
}

function extractResponseBlock(text) {
  if (!text) {
    return '';
  }
  const start = text.indexOf('<response');
  const end = text.lastIndexOf('</response>');
  if (start === -1 || end === -1) {
    return '';
  }
  const closing = '</response>'.length;
  return text.slice(start, end + closing).trim();
}

function extractResponseText(response) {
  if (!response) {
    return '';
  }
  if (typeof response.text === 'function') {
    return response.text();
  }
  if (typeof response.text === 'string') {
    return response.text;
  }
  const parts = response.candidates?.[0]?.content?.parts || [];
  const textParts = parts.map((part) => part.text).filter(Boolean);
  return textParts.join('\n');
}

function normalizeMediaResolution(value) {
  if (!value) {
    return null;
  }
  const key = String(value).trim().toUpperCase();
  if (key === 'LOW' || key === 'MEDIA_RESOLUTION_LOW') return 'MEDIA_RESOLUTION_LOW';
  if (key === 'MEDIUM' || key === 'MEDIA_RESOLUTION_MEDIUM') return 'MEDIA_RESOLUTION_MEDIUM';
  if (key === 'HIGH' || key === 'MEDIA_RESOLUTION_HIGH') return 'MEDIA_RESOLUTION_HIGH';
  return null;
}

function normalizeThinkingLevel(value) {
  if (!value) {
    return null;
  }
  const key = String(value).trim().toUpperCase();
  if (key === 'LOW') return 'LOW';
  if (key === 'HIGH') return 'HIGH';
  return null;
}

function resolveAgentPromptPath(mode, overridePath) {
  if (overridePath) {
    return path.resolve(overridePath);
  }
  const key = (mode || '').toLowerCase();
  if (key === 'long' || key === 'longform' || key === 'extenso') {
    return LONG_AGENT_PROMPT_PATH;
  }
  if (key === 'top' || key === 'top5' || key === 'ranking') {
    return TOP_AGENT_PROMPT_PATH;
  }
  return AGENT_PROMPT_PATH;
}

async function gatherContextForItems(items) {
  const contextMap = new Map();
  const infoCache = new Map();
  for (const item of items) {
    const absolutePath = path.resolve(item.path);
    const contexts = [];

    const perFileMeta = await readJSONIfExists(`${absolutePath}.json`);
    if (perFileMeta) {
      const perFileContext = extractContextText(perFileMeta);
      if (perFileContext) {
        contexts.push(perFileContext);
      }
    }

    const dir = path.dirname(absolutePath);
    let dirContext = infoCache.get(dir);
    if (dirContext === undefined) {
      dirContext = await loadInfoContext(dir);
      infoCache.set(dir, dirContext);
    }
    if (dirContext) {
      contexts.push(dirContext);
    }

    const combined = contexts
      .filter(Boolean)
      .map((block) => `[MEDIA_CONTEXT]\n${block}`)
      .join('\n');
    if (combined) {
      contextMap.set(absolutePath, combined);
      debugLog('Context detected for', absolutePath, combined);
    }
  }
  return contextMap;
}

async function loadInfoContext(dir) {
  try {
    const entries = await fs.readdir(dir);
    const contexts = [];
    for (const name of entries) {
      if (!name.endsWith('.info.json')) {
        continue;
      }
      const meta = await readJSONIfExists(path.join(dir, name));
      if (!meta) {
        continue;
      }
      const text = extractContextText(meta);
      if (text) {
        contexts.push(text);
      }
    }
    return contexts.filter(Boolean).join('\n');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    debugLog('Error reading info.json in', dir, error);
    return '';
  }
}

async function readJSONIfExists(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    debugLog('Could not read JSON', filePath, error);
    return null;
  }
}

function extractContextText(meta) {
  if (!meta || typeof meta !== 'object') {
    return '';
  }

  const segments = new Set();
  const add = (label, value, max = 1200) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
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
    ['content', 'Contenido'],
    ['commentary', 'Comentario']
  ];
  for (const [key, label] of textFields) {
    add(label, meta[key]);
  }

  const poster = meta.author || meta.uploader || meta.owner || meta.channel;
  add('Autor', poster);

  if (typeof meta.upload_date === 'string' && meta.upload_date.trim()) {
    segments.add(`Fecha: ${meta.upload_date.trim()}`);
  }

  if (Array.isArray(meta.tags) && meta.tags.length) {
    segments.add(`Tags: ${meta.tags.slice(0, 12).join(', ')}`);
  }

  if (Array.isArray(meta.keywords) && meta.keywords.length) {
    segments.add(`Keywords: ${meta.keywords.slice(0, 12).join(', ')}`);
  }

  return Array.from(segments).join('\n');
}

function extractPrimaryText(meta) {
  if (!meta || typeof meta !== 'object') {
    return '';
  }
  const fields = [
    'tweet_text',
    'full_text',
    'text',
    'description',
    'caption',
    'title',
    'summary',
    'content',
    'commentary'
  ];
  for (const key of fields) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function extractTag(xml, tag) {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(pattern);
  return match ? match[1].trim() : '';
}

async function appendSessionLog(targetPath, xml) {
  const resolved = path.resolve(targetPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const timestamp = new Date().toISOString();
  const entry = `\n[${timestamp}]\n${xml}\n`;
  await fs.appendFile(resolved, entry, 'utf8');
}

function normalizeStyle(value) {
  if (!value) {
    return null;
  }
  const key = value.toLowerCase();
  if (STYLE_ALIASES[key]) {
    return STYLE_ALIASES[key];
  }
  if (STYLE_PRESETS[key]) {
    return key;
  }
  return null;
}

async function safeStat(target) {
  try {
    return await fs.stat(target);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function cleanTweetContext(context) {
  if (!context) {
    return '';
  }
  return context
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('[MEDIA_CONTEXT]') && !line.startsWith('Contenido:'))
    .join('\n');
}

function logResult(item, text, context = null) {
  const tweetContext = cleanTweetContext(context);

  if (tweetContext) {
    console.log('\n―― tweet text');
    console.log(tweetContext);
  }

  const label = `${item.type} transcript`;
  console.log('\n―― ' + label);
  console.log(text ? text : '[no text detected]');
}

function sanitizeAssistantText(text) {
  if (!text) {
    return '';
  }
  return stripXmlTags(text).trim();
}

function logRunInfo(options) {
  const resolvedPrompt = resolveAgentPromptPath(options.mode, options.agentPromptPath);
  const modeLabel = options.mode || DEFAULT_MODE;
  const styleLabel = options.style || 'default';
  const inputLabel = options.url ? `url=${options.url}` : options.inputPath ? `path=${options.inputPath}` : 'n/a';
  console.log(`
[twx] mode=${modeLabel} prompt=${path.basename(resolvedPrompt)} style=${styleLabel}`);
  console.log(
    `[twx] ocr=${MISTRAL_OCR_MODEL} (mistral) agent=${DEFAULT_AGENT_MODEL} thinking=${DEFAULT_THINKING_LEVEL} media_res=${DEFAULT_MEDIA_RESOLUTION}`
  );
  console.log(
    `[twx] whisper_model=${DEFAULT_TRANSCRIBE_MODEL} segment=${WHISPER_SEGMENT_SECONDS}s bitrate=${WHISPER_TARGET_BITRATE} sample_rate=${WHISPER_TARGET_SAMPLE_RATE}`
  );
  console.log(`[twx] source=${inputLabel}`);
}

async function persistRun({ options, results, agentData, promptPath, rawMode, shouldRunAgent }) {
  try {
    const doc = {
      source: { url: options.url || null, path: options.inputPath || null },
      mode: options.mode || DEFAULT_MODE,
      style: options.style || 'default',
      ocrModel: MISTRAL_OCR_MODEL,
      agentModel: DEFAULT_AGENT_MODEL,
      whisperModel: DEFAULT_TRANSCRIBE_MODEL,
      mediaResolution: DEFAULT_MEDIA_RESOLUTION,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
      promptName: promptPath ? path.basename(promptPath) : null,
      title:
        sanitizeTitle(agentData?.title) ||
        buildAutoTitle({ results, fallback: options.url || options.inputPath || '' }),
      reflection: agentData?.reflection || null,
      actionPlan: agentData?.plan || null,
      finalResponse: agentData?.finalResponse || null,
      xml: agentData?.xml || null,
      results,
      metadata: {
        rawMode: Boolean(rawMode),
        agentRequested: Boolean(shouldRunAgent)
      }
    };
    await saveRun(doc);
    debugLog('Run persisted to Mongo.');
  } catch (error) {
    console.warn('⚠️ No se pudo guardar el historial en Mongo:', error instanceof Error ? error.message : error);
    debugLog('Persist error details:', error);
  }
}

async function handleListCommand(options) {
  try {
    const runs = await listRuns({ limit: options.listLimit });
    if (!runs.length) {
      console.log('\n(no hay ejecuciones guardadas)');
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(runs, null, 2));
      return;
    }
    console.log(`\nÚltimas ${runs.length} ejecuciones:`);
    runs.forEach((run, idx) => {
      const date = new Date(run.createdAt).toISOString();
      const title = run.title || '[sin título]';
      const source = run.source?.url || run.source?.path || '';
      console.log(`${idx + 1}. ${run._id} | ${date} | ${title} | ${source}`);
    });
    if (supportsInteractivePrompts()) {
      const input = await promptUser('\nSeleccioná # o id para ver el resumen (Enter para salir): ');
      const trimmed = input.trim();
      if (!trimmed) return;
      let chosen = null;
      if (/^\d+$/.test(trimmed)) {
        const idx = Number(trimmed) - 1;
        if (idx >= 0 && idx < runs.length) {
          chosen = runs[idx]._id.toString();
        }
      } else {
        chosen = trimmed;
      }
      if (chosen) {
        await handleShowCommand(chosen);
      } else {
        console.log('Selección inválida.');
      }
    }
  } catch (error) {
    console.error('No pude listar el historial:', error instanceof Error ? error.message : error);
    debugLog('List error details:', error);
  }
}

async function handleShowCommand(id) {
  try {
    const run = await getRunById(id);
    if (!run) {
      console.log(`No encontré la ejecución con id ${id}`);
      return;
    }
    printRun(run);
  } catch (error) {
    console.error('No pude mostrar la ejecución:', error instanceof Error ? error.message : error);
    debugLog('Show error details:', error);
  }
}

function printRun(run) {
  const date = run.createdAt ? new Date(run.createdAt).toISOString() : '';
  const source = run.source?.url || run.source?.path || '';
  const title = run.title || '[sin título]';
  console.log('\n— run —');
  console.log(`id: ${run._id}`);
  console.log(`fecha: ${date}`);
  console.log(`título: ${title}`);
  if (source) console.log(`origen: ${source}`);
  if (run.finalResponse) {
    printFinalResponse(run.finalResponse);
  } else if (run.results?.length) {
    const combined = run.results
      .filter((r) => r.text)
      .map((r) => `### ${r.file}\n${r.text}`)
      .join('\n\n');
    if (combined) {
      console.log('\n—— transcript ——');
      console.log(combined);
    }
  } else {
    console.log('(sin contenido almacenado)');
  }
}

function stripXmlTags(text) {
  if (!text) {
    return '';
  }
  return text.replace(/<[^>]+>/g, '');
}

function printFinalResponse(finalResponse) {
  if (!finalResponse) {
    console.warn('Agent response is missing <final_response>.');
    return;
  }
  const border = '—— musk summary ——';
  const body = stripXmlTags(finalResponse).trim();
  console.log(`\n${border}`);
  console.log(body);
  console.log(border);
}

function parseTweetInfo(rawUrl) {
  try {
    const { hostname, pathname } = new URL(rawUrl);
    if (!TWITTER_HOSTS.has(hostname.toLowerCase())) {
      return null;
    }
    const parts = pathname.split('/').filter(Boolean);
    const statusIndex = parts.findIndex((part) => part === 'status' || part === 'statuses');
    if (statusIndex === -1 || !parts[statusIndex + 1]) {
      const id = parts.find((part) => /^\d{5,}$/.test(part));
      return id ? { id, user: parts[0] || null } : null;
    }
    const id = parts[statusIndex + 1].split('?')[0];
    const user = parts[statusIndex - 1] || null;
    return { id, user };
  } catch {
    return null;
  }
}

function supportsInteractivePrompts() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptUser(message) {
  if (!supportsInteractivePrompts()) {
    return '';
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(message);
  rl.close();
  return answer.trim();
}

function clearScreen() {
  if (!supportsInteractivePrompts()) {
    return;
  }
  if (typeof console.clear === 'function') {
    console.clear();
  } else {
    process.stdout.write('\x1Bc');
  }
}

async function showReflectionWindow(reflection, planText, responseText) {
  clearScreen();
  console.log('╔══════════════════════════╗');
  console.log('║       INTERNAL NOTES      ║');
  console.log('╚══════════════════════════╝');
  console.log(reflection.trim());
  while (true) {
    const back = (await promptUser('\npress [b] to go back: ')).toLowerCase();
    if (!back || back === 'b') {
      break;
    }
  }
  clearScreen();
  if (responseText) {
    printFinalResponse(responseText);
  }
}

async function handleReflectionOutput({
  reflection,
  xml,
  planText,
  responseText,
  showReflection,
  sessionLog
}) {
  if (!reflection) {
    if (xml) {
      await appendSessionLog(sessionLog || DEFAULT_SESSION_LOG, xml);
    }
    return;
  }

  const logPath = sessionLog || DEFAULT_SESSION_LOG;
  await appendSessionLog(logPath, xml);

  if (showReflection) {
    console.log('\n--- REFLEXIÓN INTERNA ---');
    console.log(reflection.trim());
    return;
  }

  console.log(`\nReflection saved to ${logPath}. Use --show-reflection to print it inline.`);
}

async function startConversationLoop({ client, results, options, conversationHistory, agentPromptPath }) {
  const promptPath = agentPromptPath ? path.resolve(agentPromptPath) : AGENT_PROMPT_PATH;
  const promptSource = await fs.readFile(promptPath, 'utf8');
  if (!conversationHistory.length) {
    return;
  }
  const normalizedStyle = normalizeStyle(options.style);
  const preset = normalizedStyle && STYLE_PRESETS[normalizedStyle];

  console.log('\nchat mode · press Enter or :q to exit');

  while (true) {
    const input = await promptUser('\nask elon › ');
    const trimmed = input?.trim();
    if (!trimmed || trimmed.toLowerCase() === ':q') {
      console.log('\nchat closed.');
      break;
    }

    let responseData = null;
    try {
      responseData = await generateAgentResponse({
        client,
        promptSource,
        results,
        normalizedStyle,
        preset,
        customStyle: trimmed,
        conversationHistory,
        spinnerLabel: 'replying…',
        showSpacer: false
      });
    } catch (error) {
      console.error('\nagent failed during chat turn. aborting conversation.');
      debugLog('Chat loop agent error:', error);
      break;
    }

    if (!responseData || !responseData.finalResponse) {
      console.warn('Agent did not return a reply.');
      break;
    }

    console.log('');
    printFinalResponse(responseData.finalResponse);
    if (responseData.historyAppend?.length) {
      conversationHistory.push(...responseData.historyAppend);
    }

    if (responseData.xml) {
      await appendSessionLog(options.sessionLog || DEFAULT_SESSION_LOG, responseData.xml);
    }
  }
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    url: null,
    outputFile: process.env.GEMINI_OCR_OUTPUT_FILE || process.env.OPENAI_OCR_OUTPUT_FILE || null,
    json: false,
    recursive: true,
    style: process.env.TWX_DEFAULT_STYLE || null,
    styleFile: null,
    styleText: null,
    showReflection: false,
    sessionLog: process.env.TWX_SESSION_LOG || null,
    agentPromptPath: null,
    mode: DEFAULT_MODE,
    debug: false,
    list: false,
    listLimit: 10,
    showId: null
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--path' || arg === '-p') {
      options.inputPath = argv[++i];
    } else if (arg === '--url' || arg === '-u') {
      options.url = argv[++i];
    } else if (arg === '--list' || arg === '-l') {
      options.list = true;
    } else if (arg === '--limit') {
      options.listLimit = Number(argv[++i]) || options.listLimit;
    } else if (arg === '--show') {
      options.showId = argv[++i] || null;
    } else if (arg === '--output' || arg === '-o') {
      options.outputFile = argv[++i];
    } else if (arg === '--no-recursive') {
      options.recursive = false;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--style') {
      options.style = argv[++i];
    } else if (arg === '--style-file') {
      options.styleFile = argv[++i];
    } else if (arg === '--style-text') {
      options.styleText = argv[++i];
    } else if (arg === '--show-reflection') {
      options.showReflection = true;
    } else if (arg === '--session-log') {
      options.sessionLog = argv[++i];
    } else if (arg === '--agent-prompt') {
      options.agentPromptPath = argv[++i];
    } else if (arg === '--mode') {
      options.mode = (argv[++i] || '').toLowerCase();
    } else if (arg === '--long' || arg === '--longform') {
      options.mode = 'long';
    } else if (arg === '--top' || arg === '--top5') {
      options.mode = 'top';
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--help' || arg === '-h') {
      exitWithUsage(null, 0);
    } else if (arg.startsWith('-')) {
      exitWithUsage(`Unknown option: ${arg}`);
    } else {
      const lower = arg.toLowerCase();
      if (lower === 'list' || lower === 'history') {
        options.list = true;
      } else if (lower === 'show' || lower === 'view') {
        options.showId = positional[1] || null;
      } else {
        positional.push(arg);
      }
    }
  }

  if (options.list) {
    const numeric = positional.find((value) => /^\d+$/.test(value));
    if (numeric) {
      options.listLimit = Number(numeric);
    }
    return options;
  }

  if (options.showId && options.showId.startsWith('-')) {
    options.showId = null;
  }

  if (positional.length > 0) {
    const first = positional[0];
    if (!options.inputPath && !options.url) {
      if (/^https?:\/\//i.test(first)) {
        options.url = first;
      } else {
        options.inputPath = first;
      }
    } else if (!options.style) {
      options.style = first;
    }
  }

  if (positional.length > 1 && !options.style) {
    options.style = positional[1];
  }

  return options;
}

function exitWithUsage(message, exitCode = 1) {
  if (message) {
    console.error(`\n${message}`);
  }
  console.error(`
Usage: npm run ocr -- (--path <file-or-directory> | --url <tweet-or-video>) [options]

Options:
  list / --list             Listar ejecuciones previas (no requiere path/url)
  --limit <n>               Límite para --list (default: 10)
  show <id> / --show <id>   Mostrar una ejecución guardada por id
  --path, -p <value>        Local media folder or file
  --url, -u <value>         Remote URL (Twitter/X via gallery-dl, YouTube via yt-dlp)
  --output, -o <file>       Save raw JSON to disk
  --json                    Print JSON to stdout
  --style <name>            Preset (musk, buk, raw, brief, etc.)
  --style-file <file>       Custom preset instructions from a file
  --style-text <value>      Inline custom instructions
  --mode <standard|long>    Usa el prompt largo sin afectar el modo estándar
  --long / --longform       Atajo para --mode long
  --top / --top5            Atajo para --mode top (top 5 insights)
  --show-reflection         Print the internal reflection inline
  --session-log <file>      Where to store the XML response (default: ${DEFAULT_SESSION_LOG})
  --agent-prompt <file>     Override the agent prompt template
  --debug                   Verbose logging
  --no-recursive            Do not scan subdirectories
  --help, -h                Show this help

Environment:
  GEMINI_API_KEY / GOOGLE_API_KEY Requerido para usar Gemini (solo agent)
  GEMINI_VISION_MODEL             Vision model (default: ${DEFAULT_VISION_MODEL})
  MISTRAL_API_KEY                 API key para OCR Mistral (obligatorio)
  MISTRAL_ORG_ID                  Optional: header Mistral-Organization
  MISTRAL_OCR_MODEL               Modelo OCR (default: ${MISTRAL_OCR_MODEL})
  MONGODB_URL / MONGO_URL         URI MongoDB (default: mongodb://localhost:27017/twx_history)
  GEMINI_AGENT_MODEL              Agent model (default: ${DEFAULT_AGENT_MODEL})
  GEMINI_AGENT_MAX_OUTPUT_TOKENS  Max agent output tokens (default: ${DEFAULT_AGENT_MAX_OUTPUT_TOKENS})
  GEMINI_THINKING_LEVEL           Thinking depth (default: ${DEFAULT_THINKING_LEVEL})
  GEMINI_MEDIA_RESOLUTION         Vision fidelity (default: ${DEFAULT_MEDIA_RESOLUTION})
  GEMINI_OCR_DOWNLOAD_ROOT        Download directory (default: ${DOWNLOAD_ROOT})
  OPENAI_API_KEY                  Required for Whisper transcription
  OPENAI_TRANSCRIBE_MODEL         Whisper model (default: ${DEFAULT_TRANSCRIBE_MODEL})
  TWX_MODE                        default: ${DEFAULT_MODE} (use "long" for prompt extenso, "top" para top 5)
  TWX_DEFAULT_STYLE               Default preset when --style is omitted
  TWX_SESSION_LOG                 Alternate path for full reflections
  TWX_NO_SPINNER                  Set to 1 to disable spinners
  TWX_DEBUG                       Set to 1 for verbose logging by default
  WHISPER_SEGMENT_SECONDS         Segment length (s) when audio >25MB (default: ${WHISPER_SEGMENT_SECONDS})
  WHISPER_AUDIO_BITRATE           Bitrate for Whisper transcodes (default: ${WHISPER_TARGET_BITRATE})
  WHISPER_SAMPLE_RATE             Sample rate for Whisper transcodes (default: ${WHISPER_TARGET_SAMPLE_RATE})
`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\nUnexpected error while processing.');
  console.error(error);
  process.exit(1);
});
function sanitizeTitle(title) {
  if (!title) return '';
  return title
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}
