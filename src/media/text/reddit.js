import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from '../../paths.js';
import { runExternalCommand } from '../../system/exec.js';

export async function collectTextFromRedditUrl(rawUrl, config, { debug, HumanError }) {
  const env = {
    REDDIT_CLIENT_ID: config.redditClientId || process.env.REDDIT_CLIENT_ID || '',
    REDDIT_CLIENT_SECRET: config.redditClientSecret || process.env.REDDIT_CLIENT_SECRET || '',
    REDDIT_USER_AGENT: config.redditUserAgent || process.env.REDDIT_USER_AGENT || 'twx-reddit/0.1'
  };

  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    throw new HumanError('Faltan credenciales de Reddit para usar la API oficial.', {
      tip: 'Define REDDIT_CLIENT_ID y REDDIT_CLIENT_SECRET en tu .env o ejecuta "twx config".'
    });
  }

  const scriptPath = path.join(PROJECT_ROOT, 'bin', 'fetch_reddit.py');
  let pythonCmd = 'python3';

  try {
    await fs.access(path.join(PROJECT_ROOT, '.venv', 'bin', 'python3'));
    pythonCmd = path.join(PROJECT_ROOT, '.venv', 'bin', 'python3');
  } catch {
    // fallback
  }

  try {
    const raw = await runExternalCommand(pythonCmd, [scriptPath, rawUrl], { env, debug });
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
    if (debug) debug('collectTextFromRedditUrl error:', error.message);
    throw new HumanError('No pude recuperar el post de Reddit usando la API oficial.', {
      tip: 'Verifica que la URL sea pública y que las credenciales de Reddit sean correctas.',
      technical: error.message
    });
  }
}

