/**
 * Shared XML helpers for streaming agents.
 *
 * Goal: keep parsing logic consistent across CLI and Ink UI,
 * so UI changes don't risk breaking extraction of <final_response>.
 */

export function extractResponseBlock(text = '') {
  if (!text) return '';
  const lower = text.toLowerCase();
  const start = lower.indexOf('<response');
  if (start === -1) return '';
  const end = lower.lastIndexOf('</response>');
  if (end === -1) return text.slice(start).trim();
  return text.slice(start, end + '</response>'.length).trim();
}

export function extractTagStrict(xml = '', tag) {
  if (!xml) return '';
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

export function extractTagLenient(xml = '', tag) {
  if (!xml) return '';
  const lower = xml.toLowerCase();
  const open = `<${tag}`;
  const openIndex = lower.indexOf(open);
  if (openIndex === -1) return '';
  const openEnd = xml.indexOf('>', openIndex);
  if (openEnd === -1) return '';
  const closeIndex = lower.indexOf(`</${tag}`, openEnd + 1);
  if (closeIndex !== -1) return xml.slice(openEnd + 1, closeIndex).trim();
  const responseClose = lower.lastIndexOf('</response>');
  const end = responseClose !== -1 ? responseClose : xml.length;
  return xml.slice(openEnd + 1, end).trim();
}

export function stripKnownXmlTags(text = '') {
  if (!text) return '';
  return text.replace(/<\/?(response|title|internal_reflection|action_plan|final_response)\b[^>]*>/gi, '');
}

/**
 * Incremental parser that emits only the <final_response> content.
 * Tolerates missing </final_response> by stopping at </response>.
 */
export class StreamingFinalResponseParser {
  constructor() {
    this.buffer = '';
    this.inFinalResponse = false;
    this.extractedText = '';
    this.complete = false;
    this.title = '';
  }

  processChunk(chunk) {
    if (this.complete) return null;
    this.buffer += chunk;

    // Capture <title> early if available
    if (!this.title) {
      const titleMatch = this.buffer.match(/<title>([\s\S]*?)<\/title>/i);
      if (titleMatch) this.title = titleMatch[1].trim();
    }

    if (!this.inFinalResponse) {
      const lower = this.buffer.toLowerCase();
      const startIndex = lower.indexOf('<final_response');
      if (startIndex !== -1) {
        const gt = this.buffer.indexOf('>', startIndex);
        if (gt === -1) {
          if (this.buffer.length > 120) this.buffer = this.buffer.slice(-120);
          return null;
        }
        this.inFinalResponse = true;
        this.buffer = this.buffer.slice(gt + 1);
      } else {
        if (this.buffer.length > 120) this.buffer = this.buffer.slice(-120);
        return null;
      }
    }

    const lowerBuf = this.buffer.toLowerCase();
    const endIndex = lowerBuf.indexOf('</final_response');
    const responseEndIndex = lowerBuf.indexOf('</response>');
    const closeIndex =
      endIndex !== -1 ? endIndex
        : responseEndIndex !== -1 ? responseEndIndex
          : -1;

    if (closeIndex !== -1) {
      const newTextRaw = this.buffer.slice(0, closeIndex);
      const newText = stripKnownXmlTags(newTextRaw);
      this.extractedText += newText;
      this.complete = true;
      this.buffer = '';
      return newText || null;
    }

    // Emit safely while keeping tail to catch split tags
    const safeLength = Math.max(0, this.buffer.length - 40);
    const newTextRaw = this.buffer.slice(0, safeLength);
    const newText = stripKnownXmlTags(newTextRaw);
    if (newText) {
      this.extractedText += newText;
      this.buffer = this.buffer.slice(safeLength);
      return newText;
    }
    return null;
  }

  getFullText() {
    return this.extractedText;
  }

  getTitle() {
    return this.title;
  }

  isStreaming() {
    return this.inFinalResponse && !this.complete;
  }

  isComplete() {
    return this.complete;
  }
}

