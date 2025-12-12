import { TWITTER_HOSTS } from '../constants.js';

export function parseTweetInfo(rawUrl) {
  try {
    const { hostname, pathname } = new URL(rawUrl);
    if (!TWITTER_HOSTS.has(hostname.toLowerCase())) return null;

    const parts = pathname.split('/').filter(Boolean);
    const statusIndex = parts.findIndex((p) => p === 'status' || p === 'statuses');

    if (statusIndex === -1 || !parts[statusIndex + 1]) {
      const id = parts.find((p) => /^\d{5,}$/.test(p));
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

