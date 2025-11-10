#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_PROMPT_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt.txt');
const DEFAULT_SESSION_LOG = path.join(PROJECT_ROOT, 'current_session.txt');

const DEFAULT_IMAGE_PROMPT =
  'Extract every piece of legible text from this image. Preserve line breaks and spacing when obvious, and return only the raw text.';
const DEFAULT_VISION_MODEL = process.env.OPENAI_OCR_MODEL || 'gpt-4.1-mini';
const MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_OCR_MAX_OUTPUT_TOKENS ?? 800);
const DEFAULT_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
const DEFAULT_AGENT_MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini';
const DOWNLOAD_ROOT =
  process.env.OPENAI_OCR_DOWNLOAD_ROOT || path.join(process.cwd(), 'gallery-dl-runs');

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
    'Summarize the material in Elon Musk’s voice: terse, technical, focused on next steps and leverage. Use short sentences and highlight bold bets.',
  bukowski:
    'Summarize like Charles Bukowski: raw, direct, a bit gritty but still actionable. Keep it streetwise and brutally honest.',
  raw: 'Return the combined transcript verbatim, with zero additional commentary.',
  brief: 'Deliver a 3-bullet executive brief with the sharpest insights only.'
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputPath && !options.url) {
    exitWithUsage('Provide either --path or --url.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    exitWithUsage('Missing OPENAI_API_KEY in environment (e.g. .env file).');
  }

  const client = new OpenAI({ apiKey });
  const mediaItems = [];
  const infoMessages = [];

  if (options.inputPath) {
    const stats = await safeStat(options.inputPath);
    if (!stats) {
      exitWithUsage(`Input path not found: ${options.inputPath}`);
    }

    if (stats.isDirectory()) {
      const collected = await collectMedia(options.inputPath, { recursive: options.recursive });
      mediaItems.push(...collected);
    } else {
      const type = getMediaType(options.inputPath);
      if (!type) {
        exitWithUsage(`Unsupported file type: ${options.inputPath}`);
      }
      mediaItems.push({ path: options.inputPath, type });
    }
  }

  if (options.url) {
    const download = await downloadRemoteMedia(options.url);
    if (!download.items.length) {
      exitWithUsage(`No supported media downloaded from URL: ${options.url}`);
    }
    mediaItems.push(...download.items);
    const relativeBase = path.relative(process.cwd(), download.baseDir) || download.baseDir;
    infoMessages.push(`Downloaded media to ${relativeBase}`);
  }

  if (!mediaItems.length) {
    exitWithUsage('No supported media available.');
  }

  const results = [];

  for (const item of mediaItems) {
    const absolutePath = path.resolve(item.path);
    const relativePath = path.relative(process.cwd(), absolutePath) || absolutePath;
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
        throw new Error(`Unsupported media type for ${relativePath}`);
      }

      results.push({ file: relativePath, type: item.type, text });
      if (!options.json) {
        logResult({ file: relativePath, type: item.type }, text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ file: relativePath, type: item.type, error: message });
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
        console.log(`\nSaved output to ${options.outputFile}`);
      }
    }
    if (options.json) {
      console.log(payload);
    }
  }

  if (!options.json && infoMessages.length) {
    for (const message of infoMessages) {
      console.log(`\nINFO: ${message}`);
    }
  }

  const shouldRunAgent = Boolean(
    (options.style || options.styleFile || options.styleText) && results.some((entry) => entry.text)
  );
  if (shouldRunAgent) {
    await runInsightAgent({
      client,
      results,
      style: options.style,
      styleFile: options.styleFile,
      styleText: options.styleText,
      showReflection: options.showReflection,
      sessionLog: options.sessionLog,
      agentPromptPath: options.agentPromptPath
    });
  }
}

async function extractTextFromImage({ client, filePath, prompt }) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_MIME_TYPES[extension];
  if (!mimeType) {
    throw new Error(`Unsupported image type for ${filePath}`);
  }

  const buffer = await fs.readFile(filePath);
  const base64 = buffer.toString('base64');
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
  await runGalleryDl(url, runDir);
  const items = await collectMedia(runDir, { recursive: true });
  return { baseDir: runDir, items };
}

async function downloadWithYtDlp(url) {
  await fs.mkdir(DOWNLOAD_ROOT, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(DOWNLOAD_ROOT, 'yt-'));
  const args = ['-P', runDir, '-o', '%(title)s.%(ext)s', '-f', 'bestaudio/best', '--no-progress', url];
  await runExternalCommand('yt-dlp', args);
  const items = await collectMedia(runDir, { recursive: true });
  return { baseDir: runDir, items };
}

async function runGalleryDl(url, baseDir) {
  const args = ['-d', baseDir, url];
  await runExternalCommand('gallery-dl', args);
}

async function runExternalCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        reject(new Error(`${command} command not found. Install it and ensure it is on your PATH.`));
        return;
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
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

  const response = await client.responses.create({
    model: DEFAULT_AGENT_MODEL,
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

  const xml = response.output_text?.trim() ?? '';
  if (!xml) {
    console.warn('Agent returned empty output.');
    return;
  }

  const reflection = extractTag(xml, 'internal_reflection');
  const plan = extractTag(xml, 'action_plan');
  const finalResponse = extractTag(xml, 'final_response');

  if (plan) {
    console.log('\n--- PLAN ---');
    console.log(plan.trim());
  }
  if (finalResponse) {
    console.log('\n--- RESPONSE ---');
    console.log(finalResponse.trim());
  }

  if (showReflection && reflection) {
    console.log('\n--- INTERNAL REFLECTION ---');
    console.log(reflection.trim());
  } else if (reflection) {
    await appendSessionLog(sessionLog || DEFAULT_SESSION_LOG, xml);
    console.log(`\nFull reflection saved to ${sessionLog || DEFAULT_SESSION_LOG}`);
  }
}

function buildAgentPayload({ results, styleKey, preset, customStyle }) {
  const blocks = [];
  blocks.push(`Style preset: ${styleKey || 'none'}`);
  if (preset) {
    blocks.push(`Preset instructions:\n${preset}`);
  }
  if (customStyle?.trim()) {
    blocks.push(`Custom instructions:\n${customStyle.trim()}`);
  }

  blocks.push(
    'Media items:\n' +
      results
        .map((entry, index) => {
          const base = [`Item ${index + 1}`, `File: ${entry.file}`, `Type: ${entry.type}`];
          if (entry.error) {
            base.push(`Error: ${entry.error}`);
          } else {
            base.push(`Text:\n${entry.text || '[No text detected]'}`);
          }
          return base.join('\n');
        })
        .join('\n\n')
  );

  return blocks.join('\n\n');
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
  console.log(text ? text : '[No text detected]');
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
    agentPromptPath: null
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
Usage: npm run ocr -- (--path <file-or-directory> | --url <tweet-or-video-url>) [options]

Options:
  --path, -p <value>        File or directory with media
  --url, -u <value>         Remote URL to download (Twitter/X via gallery-dl, YouTube via yt-dlp)
  --prompt <value>          Custom OCR prompt for images
  --output, -o <file>       Save results as JSON to a file
  --json                    Print JSON to stdout
  --style <name>            Apply a preset post-processor (e.g. musk, buk, raw, brief)
  --style-file <file>       Provide custom instructions for the post-processor
  --style-text <value>      Inline custom instructions for the post-processor
  --show-reflection         Print the internal reflection block instead of hiding it
  --session-log <file>      Where to store the full XML response (default: current_session.txt)
  --agent-prompt <file>     Override the default agent prompt template
  --no-recursive            Do not look into subdirectories
  --help, -h                Show this help message

Environment:
  OPENAI_API_KEY                 Required. Your OpenAI API key (loaded from .env if present)
  OPENAI_OCR_MODEL               Override default vision model (default: ${DEFAULT_VISION_MODEL})
  OPENAI_OCR_PROMPT              Override default extraction prompt
  OPENAI_TRANSCRIBE_MODEL        Override default transcription model (default: ${DEFAULT_TRANSCRIBE_MODEL})
  OPENAI_AGENT_MODEL             Override default agent model (default: ${DEFAULT_AGENT_MODEL})
  OPENAI_OCR_MAX_OUTPUT_TOKENS   Adjust max tokens (default: ${MAX_OUTPUT_TOKENS})
  OPENAI_OCR_DOWNLOAD_ROOT       Override media download directory (default: ${DOWNLOAD_ROOT})
  TWX_DEFAULT_STYLE              Default style preset when --style is omitted
  TWX_SESSION_LOG                Alternate path for saving full reflections
`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\nUnexpected error during processing.');
  console.error(error);
  process.exit(1);
});
