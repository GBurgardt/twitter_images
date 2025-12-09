/**
 * useClipboard.js - Detectar URLs en clipboard
 */

import { useState, useCallback } from 'react';

/**
 * Verifica si un string es una URL válida
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const url = new URL(str.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function useClipboard() {
  const [clipboardUrl, setClipboardUrl] = useState(null);

  const checkClipboard = useCallback(async () => {
    try {
      const { default: clipboard } = await import('clipboardy');
      const text = await clipboard.read();
      const trimmed = text?.trim();

      if (isValidUrl(trimmed)) {
        setClipboardUrl(trimmed);
        return trimmed;
      } else {
        setClipboardUrl(null);
        return null;
      }
    } catch {
      setClipboardUrl(null);
      return null;
    }
  }, []);

  const writeToClipboard = useCallback(async (text) => {
    try {
      const { default: clipboard } = await import('clipboardy');
      await clipboard.write(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    clipboardUrl,
    checkClipboard,
    writeToClipboard
  };
}
