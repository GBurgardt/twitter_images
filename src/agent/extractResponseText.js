export function extractResponseText(response, provider = 'gemini') {
  if (!response) return '';
  if (provider === 'claude') {
    const parts = response.content || [];
    return parts
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p?.text) return p.text;
        if (p?.type === 'text') return p.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof response.text === 'function') return response.text();
  if (typeof response.text === 'string') return response.text;
  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text).filter(Boolean).join('\n');
}

