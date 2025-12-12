import process from 'node:process';

export const MAX_INLINE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_WHISPER_FILE_BYTES = 25 * 1024 * 1024;

export const IMAGE_MIME_TYPES = {
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

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.webm', '.m4v']);
export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);
export const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.rtf']);

export const TWITTER_HOSTS = new Set(['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com', 'mobile.twitter.com']);
export const YTDLP_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'instagram.com',
  'www.instagram.com',
  'instagr.am'
]);
export const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com']);

export const TWITTER_THREAD_API =
  process.env.TWITTER_THREAD_API_URL || 'https://superexplainer.app/twitter-api/scrape_thread/';

export const TWITTER_THREAD_MAX_TWEETS = (() => {
  const val = Number(process.env.TWITTER_THREAD_MAX_TWEETS) || 100;
  return Number.isFinite(val) ? Math.min(100, Math.max(1, val)) : 100;
})();

