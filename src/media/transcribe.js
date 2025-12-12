import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MAX_WHISPER_FILE_BYTES } from './constants.js';
import { runExternalCommand } from '../system/exec.js';

export async function transcribeMedia({ openaiClient, filePath, clipRange = null, config, debug, HumanError }) {
  const whisperSegmentSeconds = config.whisperSegmentSeconds || 480;
  const whisperBitrate = config.whisperBitrate || '48k';
  const whisperSampleRate = config.whisperSampleRate || '16000';

  const clipped = await clipMediaSegment(filePath, clipRange, { whisperBitrate, whisperSampleRate, debug, HumanError });
  const prepared = await prepareAudioForWhisper(clipped.path, { whisperBitrate, whisperSampleRate, debug, HumanError });
  const segmented = await splitAudioIfNeeded(prepared.path, { whisperSegmentSeconds, whisperBitrate, whisperSampleRate, debug, HumanError });

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
    throw new HumanError('Could not transcribe audio.', {
      tip: 'File may be empty or in an unsupported format.'
    });
  }

  return parts.join('\n\n');
}

async function prepareAudioForWhisper(filePath, { whisperBitrate, whisperSampleRate, debug, HumanError }) {
  const stats = await fs.stat(filePath);
  if (stats.size <= MAX_WHISPER_FILE_BYTES) {
    return { path: filePath, cleanup: null };
  }

  if (debug) debug('Compressing audio for Whisper...');
  return transcodeForWhisper(filePath, { whisperBitrate, whisperSampleRate, debug, HumanError });
}

async function transcodeForWhisper(filePath, { whisperBitrate, whisperSampleRate, debug, HumanError }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-audio-'));
  const basename = path.basename(filePath, path.extname(filePath));
  const targetPath = path.join(tmpDir, `${basename}-twx.m4a`);

  try {
    await runExternalCommand(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', filePath, '-vn', '-ac', '1', '-ar', whisperSampleRate, '-b:a', whisperBitrate, targetPath],
      { debug }
    );
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new HumanError('ffmpeg required to compress audio.', {
      tip: 'Install with: brew install ffmpeg',
      technical: error.message
    });
  }

  return {
    path: targetPath,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

async function clipMediaSegment(filePath, clipRange, { whisperBitrate, whisperSampleRate, debug, HumanError }) {
  if (!clipRange || (clipRange.start == null && clipRange.end == null)) {
    return { path: filePath, cleanup: null };
  }

  const start = Math.max(0, clipRange.start ?? 0);
  const end = clipRange.end != null ? Math.max(clipRange.end, 0) : null;
  const duration = end != null ? Math.max(0, end - start) : null;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-clip-'));
  const basename = path.basename(filePath, path.extname(filePath));
  const targetPath = path.join(tmpDir, `${basename}-clip.m4a`);

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', filePath, '-vn', '-ac', '1', '-ar', whisperSampleRate, '-b:a', whisperBitrate];
  if (duration && duration > 0) args.push('-t', String(duration));
  args.push(targetPath);

  try {
    await runExternalCommand('ffmpeg', args, { debug });
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new HumanError('Error clipping audio.', { technical: error.message });
  }

  return {
    path: targetPath,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

async function splitAudioIfNeeded(filePath, { whisperSegmentSeconds, whisperBitrate, whisperSampleRate, debug, HumanError }) {
  const stats = await fs.stat(filePath);
  if (stats.size <= MAX_WHISPER_FILE_BYTES) {
    return { paths: [filePath], cleanup: null };
  }

  if (debug) debug(`Splitting audio into ~${Math.round(whisperSegmentSeconds / 60)} min chunks...`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'twx-chunks-'));
  const pattern = path.join(tmpDir, 'chunk-%03d.m4a');

  await runExternalCommand(
    'ffmpeg',
    [
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
      whisperSampleRate,
      '-b:a',
      whisperBitrate,
      '-f',
      'segment',
      '-segment_time',
      String(whisperSegmentSeconds),
      pattern
    ],
    { debug }
  );

  const entries = await fs.readdir(tmpDir);
  const paths = entries
    .filter((n) => n.startsWith('chunk-') && n.endsWith('.m4a'))
    .map((n) => path.join(tmpDir, n))
    .sort();

  if (!paths.length) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new HumanError('Error splitting audio.');
  }

  return {
    paths,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  };
}

