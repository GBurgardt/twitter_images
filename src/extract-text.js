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
import OpenAI from 'openai';
import { PDFDocument } from 'pdf-lib';

// Módulos propios
import { loadConfig, isConfigured, runSetup, showConfig, resetConfig } from './config.js';
import * as ui from './ui.js';
import * as errors from './errors.js';
import { saveRun, listRuns, buildAutoTitle, getRunById } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt.txt');
const LONG_AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt_long.txt');
const TOP_AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt_top.txt');
const DEFAULT_SESSION_LOG = path.join(PROJECT_ROOT, 'current_session.txt');

// Cargar .env como fallback
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

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

const STYLE_PRESETS = {
  musk: 'Resumí en español con la voz de Elon Musk: frases cortas, tono técnico y enfoque en próximos pasos y apuestas audaces.',
  bukowski: 'Resumí en español como Charles Bukowski: crudo, directo, sin adornos pero con acciones claras.',
  raw: 'Devuelve el texto original sin resumir ni comentar.',
  brief: 'Armá un brief ejecutivo en tres viñetas con las ideas más filosas, siempre en español.'
};

const STYLE_ALIASES = {
  m: 'musk', mx: 'musk', max: 'musk', elon: 'musk', musk: 'musk',
  buk: 'bukowski', bukowski: 'bukowski', bk: 'bukowski',
  raw: 'raw', plain: 'raw', txt: 'raw',
  brief: 'brief', sum: 'brief'
};

const TWITTER_HOSTS = new Set(['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'mobile.twitter.com']);
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

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
      ui.clack.log.success('Configuración reseteada.');
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

  // Comando: show
  if (options.showId) {
    await handleShowCommand(options.showId, options);
    return;
  }

  // Verificar configuración
  if (!await isConfigured()) {
    await runSetup();
    return;
  }

  // Validar input
  if (!options.inputPath && !options.url) {
    showUsage();
    return;
  }

  // Cargar config
  const config = await loadConfig();

  ui.debug('Config loaded:', { ...config, mistralApiKey: '***', geminiApiKey: '***', openaiApiKey: '***' });
  ui.debug('Options:', options);

  // Validar API keys necesarias
  if (!config.mistralApiKey) {
    errors.show(new Error('Falta MISTRAL_API_KEY'));
    return;
  }

  // Inicializar clientes
  const geminiClient = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;
  const openaiClient = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null;

  // Procesar medios
  const spin = ui.spinner('Analizando...');

  try {
    const { items: mediaItems, cleanup } = await collectMediaItems(options, config);

    if (!mediaItems.length) {
      spin.error('Sin contenido');
      errors.show(new errors.HumanError('No encontré contenido para procesar.', {
        tip: 'Verificá que la URL sea válida o que la carpeta contenga archivos de imagen/audio/video.'
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

      spin.update(`Procesando ${i + 1}/${mediaItems.length}...`);
      ui.debug('Processing:', relativePath, 'type:', item.type);

      try {
        let text = '';

        if (item.type === 'image') {
          text = await extractTextFromImage({ filePath: absolutePath, config });
        } else if (item.type === 'video' || item.type === 'audio') {
          if (!openaiClient) {
            throw new errors.HumanError('Necesito OpenAI API key para transcribir audio/video.', {
              tip: 'Ejecutá "twx config" para agregar tu clave de OpenAI.'
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

    spin.success('Listo');

    // Modo raw: solo mostrar transcripciones
    const normalizedStyle = normalizeStyle(options.style || config.style);
    const rawMode = normalizedStyle === 'raw' && !options.styleFile && !options.styleText;

    if (rawMode) {
      const combined = results
        .filter(r => r.text)
        .map(r => r.text)
        .join('\n\n');

      if (combined) {
        ui.showRawResult(combined, { label: 'Transcripción' });
      }

      await persistRun({ options, config, results, agentData: null, rawMode: true });
      return;
    }

    // Ejecutar agente IA
    let agentData = null;
    let conversationHistory = [];

    if (geminiClient && results.some(r => r.text)) {
      const agentResult = await runInsightAgent({
        client: geminiClient,
        results,
        style: options.style || config.style,
        styleFile: options.styleFile,
        styleText: options.styleText,
        mode: options.mode || config.mode,
        config
      });

      if (agentResult) {
        agentData = agentResult.agentData;
        conversationHistory = agentResult.history || [];

        // Mostrar resultado
        if (agentData?.finalResponse) {
          ui.showResult(stripXmlTags(agentData.finalResponse), {
            title: agentData.title || null
          });
        }
      }
    } else if (!geminiClient) {
      errors.warn('Sin clave Gemini, no puedo analizar con IA.', {
        verbose: options.verbose,
        technical: 'Ejecutá "twx config" para agregar GEMINI_API_KEY'
      });

      // Mostrar raw como fallback
      const combined = results.filter(r => r.text).map(r => r.text).join('\n\n');
      if (combined) {
        ui.showRawResult(combined);
      }
    }

    // Guardar en historial
    await persistRun({ options, config, results, agentData, rawMode: false });

    // Modo chat interactivo
    if (geminiClient && ui.isInteractive() && agentData?.finalResponse) {
      await startConversationLoop({
        client: geminiClient,
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
      throw new errors.HumanError(`No encontré: ${options.inputPath}`, {
        tip: 'Verificá que la ruta sea correcta.'
      });
    }

    if (stats.isDirectory()) {
      const collected = await collectMedia(options.inputPath, { recursive: options.recursive });
      items.push(...collected);
    } else {
      const type = getMediaType(options.inputPath);
      if (!type) {
        throw new errors.HumanError(`Tipo de archivo no soportado: ${options.inputPath}`, {
          tip: 'Formatos soportados: imágenes (jpg, png, gif, webp), audio (mp3, m4a, wav), video (mp4, mkv, mov)'
        });
      }
      items.push({ path: options.inputPath, type });
    }
  }

  if (options.url) {
    const download = await downloadRemoteMedia(options.url, config);
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

async function downloadRemoteMedia(url, config) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new errors.HumanError(`URL inválida: ${url}`, {
      tip: 'Asegurate de copiar la URL completa.'
    });
  }

  const downloadRoot = config.downloadRoot || path.join(os.tmpdir(), 'twx-gallery-dl');

  if (YOUTUBE_HOSTS.has(hostname)) {
    return downloadWithYtDlp(url, downloadRoot);
  }

  return downloadWithGalleryDl(url, downloadRoot);
}

async function downloadWithGalleryDl(url, downloadRoot) {
  await fs.mkdir(downloadRoot, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(downloadRoot, 'run-'));

  ui.debug('Downloading with gallery-dl:', url);

  try {
    await runExternalCommand('gallery-dl', ['--quiet', '--write-info-json', '--write-metadata', '-d', runDir, url]);
  } catch (error) {
    throw new errors.HumanError('No pude descargar ese contenido.', {
      tip: 'Verificá que la URL sea pública y gallery-dl esté instalado.',
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
    await runExternalCommand('yt-dlp', [
      '-q', '-P', runDir, '-o', '%(title)s.%(ext)s',
      '-f', 'bestaudio/best', '--no-progress', '--write-info-json', url
    ]);
  } catch (error) {
    throw new errors.HumanError('No pude descargar ese video.', {
      tip: 'Verificá que la URL sea válida y yt-dlp esté instalado.',
      technical: error.message
    });
  }

  const items = await collectMedia(runDir, { recursive: true });
  return { baseDir: runDir, items };
}

// ============ OCR ============

async function extractTextFromImage({ filePath, config }) {
  if (!config.mistralApiKey) {
    throw new errors.HumanError('Falta la clave de Mistral para OCR.');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[ext] || 'image/png';
  const buffer = await fs.readFile(filePath);

  if (buffer.length > MAX_INLINE_FILE_BYTES) {
    throw new errors.HumanError('Imagen demasiado grande.', {
      tip: `El límite es 20MB. Esta imagen tiene ${Math.round(buffer.length / (1024 * 1024))}MB.`
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
    throw new errors.HumanError('Falló el OCR de Mistral.', {
      technical: `${response.status} ${response.statusText}: ${raw.slice(0, 200)}`
    });
  }

  const data = JSON.parse(raw);
  const text = extractMistralOcrText(data);

  if (!text) {
    throw new errors.HumanError('No pude leer texto de la imagen.', {
      tip: 'La imagen puede estar muy borrosa o no contener texto.'
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
    throw new errors.HumanError('No pude transcribir el audio.', {
      tip: 'El archivo puede estar vacío o en un formato no soportado.'
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
    throw new errors.HumanError('Necesito ffmpeg para comprimir audio.', {
      tip: 'Instalalo con: brew install ffmpeg',
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
    throw new errors.HumanError('Error recortando audio.', { technical: error.message });
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
    throw new errors.HumanError('Error segmentando audio.');
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

// ============ AGENT ============

async function runInsightAgent({ client, results, style, styleFile, styleText, mode, config }) {
  const promptPath = resolveAgentPromptPath(mode);
  const promptSource = await fs.readFile(promptPath, 'utf8');

  const normalizedStyle = normalizeStyle(style);
  const preset = normalizedStyle && STYLE_PRESETS[normalizedStyle];
  const customStyle = styleText || (styleFile ? await fs.readFile(path.resolve(styleFile), 'utf8') : '');

  const spin = ui.spinner('Pensando...');

  try {
    const payload = buildAgentPayload({ results, styleKey: normalizedStyle, preset, customStyle });
    ui.debug('Agent payload length:', payload.length);

    const safetySettings = [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
    ];

    const userContent = { role: 'user', parts: [{ text: payload }] };

    const response = await client.models.generateContent({
      model: config.agentModel || 'gemini-3-pro-preview',
      contents: [userContent],
      systemInstruction: { parts: [{ text: promptSource }] },
      safetySettings,
      config: {
        maxOutputTokens: 64000,
        temperature: 1,
        thinkingLevel: config.thinkingLevel || 'HIGH',
        mediaResolution: config.mediaResolution || 'MEDIA_RESOLUTION_HIGH'
      }
    });

    spin.success('Listo');

    const rawXml = extractResponseText(response)?.trim() ?? '';
    const xml = extractResponseBlock(rawXml);

    if (!xml) {
      ui.debug('No <response> block in:', rawXml.slice(0, 500));
      return null;
    }

    const reflection = extractTag(xml, 'internal_reflection');
    const plan = extractTag(xml, 'action_plan');
    const finalResponse = extractTag(xml, 'final_response');
    const title = extractTag(xml, 'title');

    const assistantContent = response?.candidates?.[0]?.content || null;

    return {
      agentData: { reflection, plan, finalResponse, title, xml, promptPath },
      history: [userContent, assistantContent].filter(Boolean)
    };

  } catch (error) {
    spin.error('Error');
    ui.debug('Agent error:', error);

    if (error?.status === 429 || error?.message?.includes('quota')) {
      throw new errors.HumanError('Límite de API alcanzado.', {
        tip: 'Esperá unos minutos antes de volver a intentar.'
      });
    }

    throw error;
  }
}

function buildAgentPayload({ results, styleKey, preset, customStyle }) {
  const blocks = [];

  blocks.push('Idioma obligatorio: español neutro, tono directo y pragmático.');
  blocks.push('Devuelve exclusivamente el bloque <response>…</response>.');
  blocks.push(`Style preset: ${styleKey || 'none'}`);

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

async function startConversationLoop({ client, results, options, config, conversationHistory }) {
  const promptPath = resolveAgentPromptPath(options.mode || config.mode);
  const promptSource = await fs.readFile(promptPath, 'utf8');
  const normalizedStyle = normalizeStyle(options.style || config.style);
  const preset = normalizedStyle && STYLE_PRESETS[normalizedStyle];

  console.log('');
  ui.clack.log.info('Modo chat activo. Escribí tu pregunta o "salir" para terminar.');

  while (true) {
    const input = await ui.chatPrompt();

    if (!input || input.toLowerCase() === 'salir') {
      ui.clack.log.message('Hasta luego.');
      break;
    }

    const spin = ui.spinner('Pensando...');

    try {
      const payload = buildAgentPayload({
        results,
        styleKey: normalizedStyle,
        preset,
        customStyle: input
      });

      const userContent = { role: 'user', parts: [{ text: payload }] };

      const response = await client.models.generateContent({
        model: config.agentModel || 'gemini-3-pro-preview',
        contents: [...conversationHistory, userContent],
        systemInstruction: { parts: [{ text: promptSource }] },
        config: {
          maxOutputTokens: 64000,
          temperature: 1,
          thinkingLevel: config.thinkingLevel || 'HIGH',
          mediaResolution: config.mediaResolution || 'MEDIA_RESOLUTION_HIGH'
        }
      });

      spin.success('');

      const rawXml = extractResponseText(response)?.trim() ?? '';
      const xml = extractResponseBlock(rawXml);

      if (xml) {
        const finalResponse = extractTag(xml, 'final_response');
        if (finalResponse) {
          ui.showResult(stripXmlTags(finalResponse));
        }

        const assistantContent = response?.candidates?.[0]?.content;
        if (assistantContent) {
          conversationHistory.push(userContent, assistantContent);
        }
      }

    } catch (error) {
      spin.error('Error');
      errors.warn('No pude responder.', { verbose: options.verbose, technical: error.message });
    }
  }
}

// ============ HISTORY ============

async function handleListCommand(options) {
  try {
    const runs = await listRuns({ limit: options.listLimit || 10 });

    const selected = await ui.showHistoryList(runs, {
      onSelect: async (id) => {
        await handleShowCommand(id, options);
      }
    });

    if (!selected) return;

  } catch (error) {
    errors.show(error, { verbose: options.verbose });
  }
}

async function handleShowCommand(id, options = {}) {
  try {
    const run = await getRunById(id);

    if (!run) {
      ui.clack.log.error(`No encontré el run: ${id}`);
      return;
    }

    ui.showHistoryItem(run, { showTranscript: options.showTranscript });

    // Chat mode si está disponible
    const config = await loadConfig();
    const canChat = ui.isInteractive() && config.geminiApiKey && (run.finalResponse || run.results?.some(r => r.text));

    if (canChat) {
      const geminiClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
      const conversationHistory = run.finalResponse
        ? [{ role: 'assistant', parts: [{ text: run.finalResponse }] }]
        : [];

      await startConversationLoop({
        client: geminiClient,
        results: run.results || [],
        options: { style: run.style, mode: run.mode },
        config,
        conversationHistory
      });
    }

  } catch (error) {
    errors.show(error, { verbose: options.verbose });
  }
}

// ============ PERSISTENCE ============

async function persistRun({ options, config, results, agentData, rawMode }) {
  try {
    const doc = {
      source: { url: options.url || null, path: options.inputPath || null },
      mode: options.mode || config.mode,
      style: options.style || config.style,
      ocrModel: config.ocrModel,
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

async function runExternalCommand(command, args) {
  ui.debug('Executing:', command, args);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr?.on('data', chunk => stderr += chunk.toString());

    child.on('error', error => {
      if (error.code === 'ENOENT') {
        reject(new Error(`${command} no encontrado. Instalalo y asegurate que esté en el PATH.`));
        return;
      }
      reject(error);
    });

    child.on('exit', code => {
      if (code === 0) {
        ui.debug('Command OK:', command);
        resolve();
      } else {
        reject(new Error(`${command} falló con código ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`));
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
      else reject(new Error(`${command} falló: ${stderr.slice(0, 200)}`));
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

function resolveAgentPromptPath(mode) {
  const key = (mode || '').toLowerCase();
  if (key === 'long' || key === 'longform' || key === 'extenso') return LONG_AGENT_PROMPT_PATH;
  if (key === 'top' || key === 'top5' || key === 'ranking') return TOP_AGENT_PROMPT_PATH;
  return AGENT_PROMPT_PATH;
}

function extractResponseText(response) {
  if (!response) return '';
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
    showId: null,
    clipStart: null,
    clipEnd: null,
    clipRange: null,
    showTranscript: false,
    configCommand: false,
    configReset: false,
    configShow: false
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

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
    if (arg === '--mode') { options.mode = argv[++i]; continue; }
    if (arg === '--long' || arg === '--longform') { options.mode = 'long'; continue; }
    if (arg === '--top' || arg === '--top5') { options.mode = 'top'; continue; }
    if (arg === '--verbose' || arg === '--debug') { options.verbose = true; continue; }
    if (arg === '--transcript' || arg === '--show-transcript') { options.showTranscript = true; continue; }
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
    options.style = positional[1];
  }

  return options;
}

function showUsage() {
  console.log(`
  twx

  Pegá una URL. Obtené el insight.

  USO
    twx <url>                   Twitter, YouTube, cualquier URL
    twx <path>                  Archivos locales
    twx list                    Historial
    twx config                  Configurar API keys

  ESTILOS
    twx <url> musk              Directo, técnico (default)
    twx <url> bukowski          Crudo, sin filtro
    twx <url> brief             3 bullets
    twx <url> raw               Solo transcripción

  OPCIONES
    --clip 0:30-2:00            Fragmento de video
    --verbose                   Ver detalles técnicos
    --top                       Modo TOP 5 insights

  EJEMPLOS
    twx https://x.com/user/status/123456
    twx https://youtube.com/watch?v=abc --clip 1:00-5:00
    twx ./screenshots/ bukowski

`);
}

// ============ RUN ============

main().catch(error => {
  errors.show(error, { verbose: process.argv.includes('--verbose') });
  process.exit(1);
});
