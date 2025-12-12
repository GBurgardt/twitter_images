import { parseTweetInfo } from './twitter.js';

export async function collectTextFromFxApi(rawUrl) {
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
  } catch {
    // skip
  }

  return null;
}

