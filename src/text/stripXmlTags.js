export function stripXmlTags(text = '') {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '');
}

