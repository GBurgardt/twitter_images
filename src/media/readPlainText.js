import fs from 'node:fs/promises';

export async function readPlainText(filePath, inlineText = null) {
  if (inlineText) return String(inlineText).trim();
  const data = await fs.readFile(filePath, 'utf8');
  return data.trim();
}

