export function extractPrimaryText(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const fields = ['tweet_text', 'full_text', 'text', 'description', 'caption', 'title', 'summary', 'content'];
  for (const key of fields) {
    if (typeof meta[key] === 'string' && meta[key].trim()) {
      return meta[key].trim();
    }
  }
  return '';
}

