#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import OpenAI from 'openai';
import ora from 'ora';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt.txt');
const DEFAULT_SESSION_LOG = path.join(PROJECT_ROOT, 'current_session.txt');

const DEFAULT_IMAGE_PROMPT =
  'Extraé todo el texto legible de esta imagen. Conservá saltos de línea y espaciados evidentes y devolvé sólo el texto crudo.';
const DEFAULT_VISION_MODEL = process.env.OPENAI_OCR_MODEL || 'gpt-4.1-mini';
const MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_OCR_MAX_OUTPUT_TOKENS ?? 800);
const DEFAULT_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const DEFAULT_AGENT_MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-5-codex';
const DOWNLOAD_ROOT =
  process.env.OPENAI_OCR_DOWNLOAD_ROOT || path.join(process.cwd(), 'gallery-dl-runs');
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
  debugLog('Opciones recibidas:', options);
  if (!options.inputPath && !options.url) {
    exitWithUsage('Indicá --path o --url.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    exitWithUsage('Falta OPENAI_API_KEY en el entorno (ej: archivo .env).');
  }

  const client = new OpenAI({ apiKey });
  const mediaItems = [];
  const infoMessages = [];

  if (options.inputPath) {
    const stats = await safeStat(options.inputPath);
    if (!stats) {
      exitWithUsage(`Ruta de entrada no encontrada: ${options.inputPath}`);
    }

    if (stats.isDirectory()) {
      const collected = await collectMedia(options.inputPath, { recursive: options.recursive });
      mediaItems.push(...collected);
      debugLog('Medios detectados en carpeta:', collected.map((item) => item.path));
    } else {
      const type = getMediaType(options.inputPath);
      if (!type) {
        exitWithUsage(`Tipo de archivo no soportado: ${options.inputPath}`);
      }
      mediaItems.push({ path: options.inputPath, type });
      debugLog('Archivo individual detectado:', options.inputPath, 'tipo:', type);
    }
  }

  if (options.url) {
    const download = await downloadRemoteMedia(options.url);
    if (!download.items.length) {
      exitWithUsage(`No se descargaron medios compatibles desde: ${options.url}`);
    }
    mediaItems.push(...download.items);
    debugLog('Medios descargados desde URL:', options.url, download.items.map((item) => item.path));
    const relativeBase = path.relative(process.cwd(), download.baseDir) || download.baseDir;
    infoMessages.push(`Medios descargados en ${relativeBase}`);
  }

  if (!mediaItems.length) {
    exitWithUsage('No hay medios compatibles para procesar.');
  }

  const contextMap = await gatherContextForItems(mediaItems);

  const results = [];

  for (const item of mediaItems) {
    const absolutePath = path.resolve(item.path);
    const relativePath = path.relative(process.cwd(), absolutePath) || absolutePath;
    const spinner = startSpinner(`Procesando ${item.type} → ${path.basename(relativePath)}`);
    debugLog('Iniciando procesamiento de', relativePath, 'tipo', item.type);
    try {
      let text = '';
      if (item.type === 'image') {
        text = await extractTextFromImage({
          client,
          filePath: absolutePath,
          prompt: options.prompt
        });
      } else if (item.type === 'video' || item.type === 'audio') {
        text = await transcribeMedia({
          client,
          filePath: absolutePath
        });
      } else if (item.type === 'text') {
        text = await readPlainText(absolutePath);
      } else {
        throw new Error(`Tipo de medio no soportado: ${relativePath}`);
      }

      const context = contextMap.get(absolutePath) || null;
      results.push({ file: relativePath, type: item.type, text, context });
      debugLog('Texto obtenido', { file: relativePath, type: item.type, preview: text.slice(0, 120) });
      spinner.succeed(`Listo ${path.basename(relativePath)}`);
      if (!options.json) {
        logResult({ file: relativePath, type: item.type }, text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const context = contextMap.get(absolutePath) || null;
      results.push({ file: relativePath, type: item.type, error: message, context });
      debugLog('Error procesando', relativePath, message);
      spinner.fail(`Error en ${path.basename(relativePath)}`);
      if (!options.json) {
        console.error(`\n[ERROR] ${relativePath}`);
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
        console.log(`\nResultados guardados en ${options.outputFile}`);
      }
      debugLog('JSON guardado en', options.outputFile);
    }
    if (options.json) {
      console.log(payload);
      debugLog('JSON impreso en stdout');
    }
  }

  if (!options.json && infoMessages.length) {
    for (const message of infoMessages) {
      console.log(`\nINFO: ${message}`);
    }
  }

  const normalizedStyle = normalizeStyle(options.style);
  const hasCustomStyleInput = Boolean(options.styleFile || options.styleText);
  const rawMode = normalizedStyle === 'raw' && !hasCustomStyleInput;
  debugLog('Estilo normalizado:', normalizedStyle, 'rawMode:', rawMode);

  if (rawMode) {
    const combined = results
      .filter((entry) => entry.text)
      .map((entry) => `### ${entry.file}\n${entry.text}`)
      .join('\n\n');
    if (combined) {
      console.log('\n--- TRANSCRIPCIONES SIN PROCESAR (sin GPT) ---');
      console.log(combined);
      debugLog('Modo raw activado, combinados caracteres:', combined.length);
    }
  }

  const shouldRunAgent = Boolean(
    !rawMode &&
      (options.style || options.styleFile || options.styleText) &&
      results.some((entry) => entry.text)
  );
  debugLog('¿Ejecutar agente?', shouldRunAgent);

  if (shouldRunAgent) {
    await runInsightAgent({
      client,
      results,
      style: options.style,
      styleFile: options.styleFile,
      styleText: options.styleText,
      showReflection: options.showReflection,
      sessionLog: options.sessionLog,
      agentPromptPath: options.agentPromptPath,
      debug: DEBUG_ENABLED
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
  const base64 = buffer.toString('base64');
  debugLog('Llamando a modelo de visión con archivo', filePath, 'tamaño bytes', buffer.length);
  const response = await client.responses.create({
    model: DEFAULT_VISION_MODEL,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: `data:${mimeType};base64,${base64}` }
        ]
      }
    ]
  });

  const output = response.output_text ?? '';
  return output.trim();
}

async function transcribeMedia({ client, filePath }) {
  const stream = createReadStream(filePath);
  const response = await client.audio.transcriptions.create({
    model: DEFAULT_TRANSCRIBE_MODEL,
    file: stream,
    response_format: 'text'
  });

  if (!response) {
    throw new Error(`Empty transcription for ${filePath}`);
  }

  const text = typeof response === 'string' ? response : response.text;
  debugLog('Transcripción Whisper obtenida', { filePath, chars: text?.length || 0 });
  return (text || '').trim();
}

async function readPlainText(filePath) {
  const data = await fs.readFile(filePath, 'utf8');
  return data.trim();
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
  debugLog('Descargando con gallery-dl en', runDir, 'URL', url);
  await runGalleryDl(url, runDir);
  const items = await collectMedia(runDir, { recursive: true });
  debugLog('Archivos capturados por gallery-dl:', items.map((item) => item.path));
  return { baseDir: runDir, items };
}

async function downloadWithYtDlp(url) {
  await fs.mkdir(DOWNLOAD_ROOT, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(DOWNLOAD_ROOT, 'yt-'));
  const args = [
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
  debugLog('Descargando con yt-dlp en', runDir, 'URL', url, 'args', args);
  await runExternalCommand('yt-dlp', args);
  const items = await collectMedia(runDir, { recursive: true });
  debugLog('Archivos capturados por yt-dlp:', items.map((item) => item.path));
  return { baseDir: runDir, items };
}

async function runGalleryDl(url, baseDir) {
  const args = ['--write-info-json', '--write-metadata', '-d', baseDir, url];
  await runExternalCommand('gallery-dl', args);
}

async function runExternalCommand(command, args) {
  debugLog('Ejecutando comando:', command, args);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        reject(new Error(`Comando ${command} no encontrado. Instalalo y sumalo al PATH.`));
        return;
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        debugLog('Comando finalizado OK:', command);
        resolve();
      } else {
        reject(new Error(`${command} terminó con estado ${code}`));
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

  const payload = buildAgentPayload({
    results,
    styleKey: normalizedStyle,
    preset,
    customStyle
  });
  debugLog('Payload enviado al agente:\n' + payload);

  const agentSpinner = startSpinner('Generando plan y respuesta…');
  let response;
  try {
    response = await client.responses.create({
      model: DEFAULT_AGENT_MODEL,
      reasoning: { effort: 'high' },
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: promptSource }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: payload }]
        }
      ]
    });
    agentSpinner.succeed('Plan generado.');
  } catch (error) {
    agentSpinner.fail('Falló la generación del plan.');
    debugLog('Error del agente:', error);
    throw error;
  }

  debugLog('Respuesta cruda del agente:', safeStringify(response));

  const xml = response.output_text?.trim() ?? '';
  if (!xml) {
    console.warn('El agente devolvió una salida vacía.');
    debugLog('Respuesta sin output_text');
    return;
  }
  debugLog('XML recibido:\n' + xml);

  const reflection = extractTag(xml, 'internal_reflection');
  const plan = extractTag(xml, 'action_plan');
  const finalResponse = extractTag(xml, 'final_response');

  if (!plan) {
    console.warn('El agente no devolvió <action_plan>. Revisa el log de depuración.');
    debugLog('Falta <action_plan> en XML');
  }
  if (!finalResponse) {
    console.warn('El agente no devolvió <final_response>.');
    debugLog('Falta <final_response> en XML');
  }

  printFinalResponse(finalResponse);

  await handleReflectionOutput({
    reflection,
    xml,
    planText: plan?.trim() ?? '',
    responseText: finalResponse?.trim() ?? '',
    showReflection,
    sessionLog
  });
}

function buildAgentPayload({ results, styleKey, preset, customStyle }) {
  const blocks = [];
  blocks.push('Idioma obligatorio: español neutro, tono directo y pragmático.');
  blocks.push('Encabezados esperados: INTERPRETACIÓN PRAGMÁTICA + RESPUESTA.');
  blocks.push(
    'final_response debe contener entre 3 y 7 párrafos, cada uno de 3 a 5 líneas, sin viñetas, traduciendo el mensaje como si Elon Musk lo explicara: frases cortas, enfoque técnico, visión a largo plazo. El primer párrafo comienza con “INTERPRETACIÓN PRAGMÁTICA:” y el último con “RESPUESTA:”.'
  );
  blocks.push(`Style preset: ${styleKey || 'none'}`);
  if (preset) {
    blocks.push(`Preset instructions:\n${preset}`);
  }
  if (customStyle?.trim()) {
    blocks.push(`Custom instructions:\n${customStyle.trim()}`);
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
          if (entry.context) {
            base.push(`Contexto:\n${entry.context}`);
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

    const combined = contexts.filter(Boolean).join('\n');
    if (combined) {
      contextMap.set(absolutePath, combined);
      debugLog('Contexto detectado para', absolutePath, combined);
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
    debugLog('Error leyendo info.json en', dir, error);
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
    debugLog('No se pudo leer JSON', filePath, error);
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

function logResult(item, text) {
  console.log(`\n=== [${item.type.toUpperCase()}] ${item.file} ===`);
  console.log(text ? text : '[Sin texto detectado]');
}

function printFinalResponse(finalResponse) {
  if (!finalResponse) {
    console.warn('No se recibió <final_response> del agente.');
    return;
  }
  const border = '··· RESUMEN EN VOZ MUSK ···';
  console.log(`\n${border}`);
  console.log(finalResponse.trim());
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
  console.log('║      REFLEXIÓN INTERNA   ║');
  console.log('╚══════════════════════════╝');
  console.log(reflection.trim());
  while (true) {
    const back = (await promptUser('\nPresioná [b] para volver al resumen: ')).toLowerCase();
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

  if (!supportsInteractivePrompts()) {
    console.log(`\nReflexión completa guardada en ${logPath}`);
    return;
  }

  console.log(`\nReflexión completa guardada en ${logPath}.`);
  const choice = (await promptUser('Tocá [r] para abrirla ahora o Enter para continuar: ')).toLowerCase();
  if (choice === 'r') {
    await showReflectionWindow(reflection, planText, responseText);
    console.log(`\n(Reflexión completa guardada en ${logPath})`);
  }
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    url: null,
    prompt: process.env.OPENAI_OCR_PROMPT || DEFAULT_IMAGE_PROMPT,
    outputFile: process.env.OPENAI_OCR_OUTPUT_FILE || null,
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
      exitWithUsage(`Opción desconocida: ${arg}`);
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
Uso: npm run ocr -- (--path <archivo-o-directorio> | --url <tweet-o-video>) [opciones]

Opciones:
  --path, -p <valor>        Carpeta o archivo local con medios
  --url, -u <valor>         URL remota (Twitter/X vía gallery-dl, YouTube vía yt-dlp)
  --prompt <valor>          Prompt personalizado para OCR
  --output, -o <archivo>    Guarda el JSON en disco
  --json                    Imprime JSON por stdout
  --style <nombre>          Aplica un preset (musk, buk, raw, brief, etc.)
  --style-file <archivo>    Archivo con instrucciones personalizadas
  --style-text <valor>      Instrucciones inline para el post-procesador
  --show-reflection         Muestra la reflexión interna en consola
  --session-log <archivo>   Dónde guardar la respuesta XML (default: current_session.txt)
  --agent-prompt <archivo>  Reemplaza la plantilla del agente
  --debug                   Activa logs detallados de depuración
  --no-recursive            Evita escanear subdirectorios
  --help, -h                Muestra esta ayuda

Variables de entorno:
  OPENAI_API_KEY                 Obligatorio. Tu clave OpenAI (se carga desde .env)
  OPENAI_OCR_MODEL               Modelo visión (default: ${DEFAULT_VISION_MODEL})
  OPENAI_OCR_PROMPT              Prompt por defecto para OCR
  OPENAI_TRANSCRIBE_MODEL        Modelo de transcripción (default: ${DEFAULT_TRANSCRIBE_MODEL})
  OPENAI_AGENT_MODEL             Modelo del agente (default: ${DEFAULT_AGENT_MODEL})
  OPENAI_OCR_MAX_OUTPUT_TOKENS   Máximo de tokens (default: ${MAX_OUTPUT_TOKENS})
  OPENAI_OCR_DOWNLOAD_ROOT       Carpeta de descargas (default: ${DOWNLOAD_ROOT})
  TWX_DEFAULT_STYLE              Estilo por defecto si no se pasa --style
  TWX_SESSION_LOG                Ruta alternativa para reflexiones completas
  TWX_NO_SPINNER                 Definilo en 1 para desactivar los spinners
  TWX_DEBUG                      Definilo en 1 para logs detallados por defecto
`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\nOcurrió un error inesperado durante el procesamiento.');
  console.error(error);
  process.exit(1);
});
