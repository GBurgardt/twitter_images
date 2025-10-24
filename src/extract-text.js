#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import OpenAI from 'openai';

const DEFAULT_PROMPT =
  'Extract every piece of legible text from this image. Preserve line breaks and spacing when obvious, and return only the raw text.';
const DEFAULT_MODEL = process.env.OPENAI_OCR_MODEL || 'gpt-4.1-mini';
const MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_OCR_MAX_OUTPUT_TOKENS ?? 800);
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.inputPath && !options.url) {
    exitWithUsage('Provide either --path or --url.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    exitWithUsage('Missing OPENAI_API_KEY in environment (e.g. .env file).');
  }

  const files = [];
  const infoMessages = [];

  if (options.inputPath) {
    const stats = await safeStat(options.inputPath);
    if (!stats) {
      exitWithUsage(`Input path not found: ${options.inputPath}`);
    }

    const collected = stats.isDirectory()
      ? await collectImages(options.inputPath, { recursive: options.recursive })
      : (isSupportedImage(options.inputPath) ? [options.inputPath] : []);

    if (collected.length === 0) {
      exitWithUsage(
        `No supported image files found at ${options.inputPath} (supported: ${Object.keys(IMAGE_MIME_TYPES).join(', ')})`
      );
    }

    files.push(...collected);
  }

  if (options.url) {
    const download = await downloadTweetMedia(options.url);
    if (!download.files.length) {
      exitWithUsage(`No supported images downloaded from URL: ${options.url}`);
    }
    files.push(...download.files);
    const relativeBase = path.relative(process.cwd(), download.baseDir) || download.baseDir;
    infoMessages.push(`Downloaded media to ${relativeBase}`);
  }

  if (!files.length) {
    exitWithUsage('No images available for OCR.');
  }

  const client = new OpenAI({ apiKey });
  const results = [];

  for (const filePath of files) {
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(process.cwd(), absolutePath);

    try {
      const text = await extractTextFromImage({
        client,
        filePath: absolutePath,
        prompt: options.prompt
      });
      results.push({ file: relativePath || absolutePath, text });
      if (!options.json) {
        logResult(relativePath || absolutePath, text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ file: relativePath || absolutePath, error: message });
      if (!options.json) {
        console.error(`\n[ERROR] ${relativePath || absolutePath}`);
        console.error(`        ${message}`);
        if (message.includes('does not exist')) {
          console.error(
            '        Ajustá OPENAI_OCR_MODEL (ej: export OPENAI_OCR_MODEL=gpt-4.1-mini o gpt-4o).'
          );
        }
      }
    }
  }

  if (options.json || options.outputFile) {
    const payload = JSON.stringify({ model: DEFAULT_MODEL, results }, null, 2);
    if (options.outputFile) {
      await fs.writeFile(options.outputFile, payload, 'utf8');
      if (!options.json) {
        console.log(`\nSaved OCR output to ${options.outputFile}`);
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
    model: DEFAULT_MODEL,
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

async function downloadTweetMedia(url) {
  await fs.mkdir(DOWNLOAD_ROOT, { recursive: true });
  const runDir = await fs.mkdtemp(path.join(DOWNLOAD_ROOT, 'run-'));

  await runGalleryDl(url, runDir);
  const files = await collectImages(runDir, { recursive: true });

  return { baseDir: runDir, files };
}

async function runGalleryDl(url, baseDir) {
  const args = ['-d', baseDir, '-o', 'extractor.twitter.videos=false', url];

  await new Promise((resolve, reject) => {
    const child = spawn('gallery-dl', args, { stdio: 'inherit' });
    child.on('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        reject(new Error('gallery-dl command not found. Install it and ensure it is on your PATH.'));
        return;
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gallery-dl exited with status ${code}`));
      }
    });
  });
}

async function collectImages(targetPath, { recursive }) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isFile() && isSupportedImage(entryPath)) {
      paths.push(entryPath);
    } else if (recursive && entry.isDirectory()) {
      const subPaths = await collectImages(entryPath, { recursive });
      paths.push(...subPaths);
    }
  }

  return paths;
}

function isSupportedImage(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMAGE_MIME_TYPES, extension);
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

function logResult(filePath, text) {
  console.log(`\n=== ${filePath} ===`);
  console.log(text ? text : '[No text detected]');
}

function parseArgs(argv) {
  const options = {
    inputPath: null,
    url: null,
    prompt: process.env.OPENAI_OCR_PROMPT || DEFAULT_PROMPT,
    outputFile: process.env.OPENAI_OCR_OUTPUT_FILE || null,
    json: false,
    recursive: true
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
    } else if (arg === '--help' || arg === '-h') {
      exitWithUsage(null, 0);
    } else if (arg.startsWith('-')) {
      exitWithUsage(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    const value = positional[0];
    if (!options.inputPath && !options.url) {
      if (/^https?:\/\//i.test(value)) {
        options.url = value;
      } else {
        options.inputPath = value;
      }
    }
  }

  return options;
}

function exitWithUsage(message, exitCode = 1) {
  if (message) {
    console.error(`\n${message}`);
  }
  console.error(`
Usage: npm run ocr -- (--path <file-or-directory> | --url <tweet-url>) [options]

Options:
  --path, -p <value>        File or directory with images
  --url, -u <value>         Tweet URL to download with gallery-dl
  --prompt <value>          Custom extraction prompt
  --output, -o <file>       Save results as JSON to a file
  --json                    Print JSON to stdout
  --no-recursive            Do not look into subdirectories
  --help, -h                Show this help message

Environment:
  OPENAI_API_KEY            Required. Your OpenAI API key (loaded from .env if present)
  OPENAI_OCR_MODEL          Override default model (default: ${DEFAULT_MODEL})
  OPENAI_OCR_PROMPT         Override default extraction prompt
  OPENAI_OCR_MAX_OUTPUT_TOKENS  Adjust max tokens (default: ${MAX_OUTPUT_TOKENS})
`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('\nUnexpected error during OCR extraction.');
  console.error(error);
  process.exit(1);
});
