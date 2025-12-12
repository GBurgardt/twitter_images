import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import OpenAI from 'openai';
import * as errors from '../../errors.js';
import * as ui from '../../ui.js';
import { loadConfig } from '../../config.js';
import { YTDLP_HOSTS } from '../../media/constants.js';
import { runExternalCommand } from '../../system/exec.js';
import { transcribeMedia } from '../../media/transcribe.js';

export async function handleTranscriptCommand(options) {
  const url = options.url;

  if (!url) {
    errors.show(
      new errors.HumanError('URL requerida para transcript.', {
        tip: 'Uso: twx <youtube-url> transcript'
      })
    );
    return;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    errors.show(
      new errors.HumanError('URL inválida.', {
        tip: 'Asegúrate de copiar la URL completa.'
      })
    );
    return;
  }

  if (!YTDLP_HOSTS.has(hostname)) {
    errors.show(
      new errors.HumanError('Solo URLs de YouTube/Instagram soportadas para transcript.', {
        tip: `Host detectado: ${hostname}. Usa una URL de youtube.com o youtu.be`
      })
    );
    return;
  }

  const config = await loadConfig();
  if (!config.openaiApiKey) {
    errors.show(
      new errors.HumanError('OpenAI API key requerida para transcripción.', {
        tip: 'Ejecuta "twx config" para agregar tu clave de OpenAI.'
      })
    );
    return;
  }

  const openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  const downloadRoot = config.downloadRoot || path.join(os.tmpdir(), 'twx-transcript');

  const spin = ui.spinner('Capturando audio...');

  try {
    ui.debug('Transcript: downloading audio from', url);
    await fs.mkdir(downloadRoot, { recursive: true });
    const runDir = await fs.mkdtemp(path.join(downloadRoot, 'yt-'));

    await runExternalCommand(
      'yt-dlp',
      ['-q', '-P', runDir, '-o', '%(title)s.%(ext)s', '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--no-progress', url],
      { debug: ui.debug }
    );

    const files = await fs.readdir(runDir);
    const audioFile = files.find((f) => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.opus') || f.endsWith('.webm') || f.endsWith('.wav'));

    if (!audioFile) {
      throw new errors.HumanError('No se pudo descargar el audio.', {
        tip: 'Verifica que la URL sea válida y el video sea público.'
      });
    }

    const audioPath = path.join(runDir, audioFile);
    const stats = await fs.stat(audioPath);
    ui.debug('Audio downloaded:', audioPath, 'size:', stats.size);

    spin.update('Transcribing with Whisper...');

    const transcript = await transcribeMedia({
      openaiClient,
      filePath: audioPath,
      clipRange: options.clipRange,
      config,
      debug: ui.debug,
      HumanError: errors.HumanError
    });

    spin.success('');

    console.log('\n' + '─'.repeat(60));
    console.log(transcript);
    console.log('─'.repeat(60) + '\n');

    if (!config.keepDownloads) {
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }

    ui.debug('Transcript complete, chars:', transcript.length);
  } catch (error) {
    spin.error('Error');
    errors.show(error, { verbose: options.verbose });
  }
}

