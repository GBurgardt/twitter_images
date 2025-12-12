export function sanitizeTitle(title) {
  if (!title) return '';
  return title
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export function parseTimecode(value) {
  if (!value && value !== 0) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const parts = trimmed
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((p) => isNaN(Number(p)))) return null;

  const nums = parts.map(Number);
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 1) return nums[0];
  return null;
}

