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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt.txt');
const DEFAULT_SESSION_LOG = path.join(PROJECT_ROOT, 'current_session.txt');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

const DEFAULT_IMAGE_PROMPT =
  'Extraé todo el texto legible de esta imagen. Conservá saltos de línea y espaciados evidentes y devolvé sólo el texto crudo.';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const DEFAULT_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3-pro-preview';
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_OCR_MAX_OUTPUT_TOKENS ?? 800);
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
const MAX_INLINE_FILE_BYTES = 20 * 1024 * 1024;
const MAX_WHISPER_FILE_BYTES = 25 * 1024 * 1024;
const SPINNER_ENABLED = process.stdout.isTTY && process.env.TWX_NO_SPINNER !== '1';
let DEBUG_ENABLED = process.env.TWX_DEBUG === '1';

function debugLog(...args) {
  if (DEBUG_ENABLED) {
    console.log('[DEBUG]', ...args);
  }
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
  if (!options.inputPath && !options.url) {
    exitWithUsage('Provide --path or --url.');
  }

  const geminiKey = GEMINI_API_KEY;
  if (!geminiKey) {
    exitWithUsage('Falta GEMINI_API_KEY/GOOGLE_API_KEY en el entorno (ej: archivo .env).');
  }
  const openaiKey = OPENAI_API_KEY;
  if (!openaiKey) {
    console.warn('Falta OPENAI_API_KEY; no se podrán transcribir audios/videos con Whisper.');
  }

  const geminiClient = new GoogleGenAI({ apiKey: geminiKey });
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
          client: geminiClient,
          filePath: absolutePath,
          prompt: options.prompt
        });
      } else if (item.type === 'video' || item.type === 'audio') {
        text = await transcribeMedia({ openaiClient, filePath: absolutePath });
      } else if (item.type === 'text') {
        text = await readPlainText(absolutePath);
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

  if (shouldRunAgent) {
    const seedHistory = await runInsightAgent({
      client: geminiClient,
      results,
      style: options.style,
      styleFile: options.styleFile,
      styleText: options.styleText,
      showReflection: options.showReflection,
      sessionLog: options.sessionLog,
      agentPromptPath: options.agentPromptPath,
      debug: DEBUG_ENABLED
    });
    conversationHistory = seedHistory || [];
  }

  if (
    shouldRunAgent &&
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
      agentPromptPath: options.agentPromptPath
    });
  }
}

async function extractTextFromImage({ client, filePath, prompt }) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[extension];
  if (!mimeType) {
    throw new Error(`Tipo de imagen no soportado: ${filePath}`);
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.length > MAX_INLINE_FILE_BYTES) {
    throw new Error(`Imagen demasiado grande para inline (${Math.round(buffer.length / (1024 * 1024))}MB). Comprimila a <20MB.`);
  }
  const inlineData = {
    inlineData: { data: buffer.toString('base64'), mimeType }
  };
  debugLog('Calling vision model with file', filePath, 'bytes', buffer.length);
  const response = await client.models.generateContent({
    model: DEFAULT_VISION_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, inlineData]
      }
    ],
    config: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      mediaResolution: DEFAULT_MEDIA_RESOLUTION
    }
  });

  const output = extractResponseText(response);
  return output.trim();
}

async function transcribeMedia({ openaiClient, filePath }) {
  if (!openaiClient) {
    throw new Error('Falta OPENAI_API_KEY para transcribir audio/video con Whisper.');
  }
  const prepared = await prepareAudioForWhisper(filePath);
  const stream = createReadStream(prepared.path);
  let response;

  try {
    response = await openaiClient.audio.transcriptions.create({
      model: DEFAULT_TRANSCRIBE_MODEL,
      file: stream,
      response_format: 'text'
    });
  } finally {
    if (prepared.cleanup) {
      await prepared.cleanup();
    }
  }

  if (!response) {
    throw new Error(`Empty transcription for ${filePath}`);
  }

  const text = typeof response === 'string' ? response : response.text;
  debugLog('Whisper transcription captured', { filePath, chars: text?.length || 0 });
  return (text || '').trim();
}

async function readPlainText(filePath) {
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
    '16000',
    '-b:a',
    '64k',
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
    return [];
  }

  const { reflection, plan, finalResponse, xml, historyAppend = [] } = result;

  printFinalResponse(finalResponse);

  await handleReflectionOutput({
    reflection,
    xml,
    planText: plan?.trim() ?? '',
    responseText: finalResponse?.trim() ?? '',
    showReflection,
    sessionLog
  });

  return finalResponse ? historyAppend.slice() : [];
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

  if (!plan) {
    console.warn('Agent output missing <action_plan>. Use --debug to inspect.');
    debugLog('Missing <action_plan> in XML');
  }
  if (!finalResponse) {
    console.warn('Agent output missing <final_response>.');
    debugLog('Missing <final_response> in XML');
  }

  return {
    reflection,
    plan,
    finalResponse,
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
    'No omitas ningún tag del bloque <response>. Siempre devuelve <internal_reflection>, <action_plan> y <final_response>. Si falta información, completá igual con el mejor esfuerzo o marcá por qué no se puede, pero no dejes tags vacíos.'
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
    prompt: process.env.GEMINI_OCR_PROMPT || process.env.OPENAI_OCR_PROMPT || DEFAULT_IMAGE_PROMPT,
    outputFile: process.env.GEMINI_OCR_OUTPUT_FILE || process.env.OPENAI_OCR_OUTPUT_FILE || null,
    json: false,
    recursive: true,
    style: process.env.TWX_DEFAULT_STYLE || null,
    styleFile: null,
    styleText: null,
    showReflection: false,
    sessionLog: process.env.TWX_SESSION_LOG || null,
    agentPromptPath: null,
    debug: false
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--path' || arg === '-p') {
      options.inputPath = argv[++i];
    } else if (arg === '--url' || arg === '-u') {
      options.url = argv[++i];
    } else if (arg === '--prompt') {
      options.prompt = argv[++i];
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
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--help' || arg === '-h') {
      exitWithUsage(null, 0);
    } else if (arg.startsWith('-')) {
      exitWithUsage(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
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
  --path, -p <value>        Local media folder or file
  --url, -u <value>         Remote URL (Twitter/X via gallery-dl, YouTube via yt-dlp)
  --prompt <value>          Custom OCR prompt for images
  --output, -o <file>       Save raw JSON to disk
  --json                    Print JSON to stdout
  --style <name>            Preset (musk, buk, raw, brief, etc.)
  --style-file <file>       Custom preset instructions from a file
  --style-text <value>      Inline custom instructions
  --show-reflection         Print the internal reflection inline
  --session-log <file>      Where to store the XML response (default: ${DEFAULT_SESSION_LOG})
  --agent-prompt <file>     Override the agent prompt template
  --debug                   Verbose logging
  --no-recursive            Do not scan subdirectories
  --help, -h                Show this help

Environment:
  GEMINI_API_KEY / GOOGLE_API_KEY Required (loaded from .env)
  GEMINI_VISION_MODEL             Vision model (default: ${DEFAULT_VISION_MODEL})
  GEMINI_OCR_PROMPT               Default OCR prompt
  GEMINI_AGENT_MODEL              Agent model (default: ${DEFAULT_AGENT_MODEL})
  GEMINI_AGENT_MAX_OUTPUT_TOKENS  Max agent output tokens (default: ${DEFAULT_AGENT_MAX_OUTPUT_TOKENS})
  GEMINI_OCR_MAX_OUTPUT_TOKENS    Max tokens for OCR responses (default: ${MAX_OUTPUT_TOKENS})
  GEMINI_THINKING_LEVEL           Thinking depth (default: ${DEFAULT_THINKING_LEVEL})
  GEMINI_MEDIA_RESOLUTION         Vision fidelity (default: ${DEFAULT_MEDIA_RESOLUTION})
  GEMINI_OCR_DOWNLOAD_ROOT        Download directory (default: ${DOWNLOAD_ROOT})
  OPENAI_API_KEY                  Required for Whisper transcription
  OPENAI_TRANSCRIBE_MODEL         Whisper model (default: ${DEFAULT_TRANSCRIBE_MODEL})
  TWX_DEFAULT_STYLE               Default preset when --style is omitted
  TWX_SESSION_LOG                 Alternate path for full reflections
  TWX_NO_SPINNER                  Set to 1 to disable spinners
  TWX_DEBUG                       Set to 1 for verbose logging by default
`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\nUnexpected error while processing.');
  console.error(error);
  process.exit(1);
});
