export function maskConfig(config = {}) {
  const clone = { ...config };
  for (const key of Object.keys(clone)) {
    const lower = key.toLowerCase();
    if (lower.includes('key') || lower.includes('secret') || lower.includes('token') || lower.includes('url') || lower.includes('password')) {
      clone[key] = '***';
    }
  }
  return clone;
}

