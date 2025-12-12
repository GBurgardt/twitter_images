import { runCommandCaptureStdout } from '../../system/exec.js';
import { extractPrimaryText } from './primaryText.js';

export async function collectTextFromDump(url) {
  const items = [];
  try {
    const stdout = await runCommandCaptureStdout('gallery-dl', ['--dump-json', url]);
    const lines = stdout.split('\n').filter((l) => l.trim());

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const text = extractPrimaryText(obj);
        if (text) {
          items.push({ path: `${url}#text`, type: 'text', inlineText: text });
          break;
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  return items;
}

