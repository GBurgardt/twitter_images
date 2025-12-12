/**
 * streamAgent.js - Streaming helper for Gemini/Claude
 *
 * Provides a unified streaming interface that:
 *  - Streams tokens from the provider
 *  - Incrementally extracts <final_response> (and title) from the XML
 *  - Returns the same agentData shape expected by the app/CLI
 */

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

/**
 * Simple XML extractor used across the project
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

export function extractTag(xml = '', tag) {
  if (!xml) return '';
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function stripKnownXmlTags(text = '') {
  if (!text) return '';
  return text.replace(/<\/?(response|title|internal_reflection|action_plan|final_response)\b[^>]*>/gi, '');
}

function extractTagLenient(xml = '', tag) {
  if (!xml) return '';
  const lower = xml.toLowerCase();
  const open = `<${tag}`; // allow whitespace/attrs
  const openIndex = lower.indexOf(open);
  if (openIndex === -1) return '';
  const openEnd = xml.indexOf('>', openIndex);
  if (openEnd === -1) return '';
  const closeIndex = lower.indexOf(`</${tag}`, openEnd + 1);
  if (closeIndex !== -1) {
    const closeEnd = xml.indexOf('>', closeIndex);
    const end = closeEnd !== -1 ? closeIndex : closeIndex;
    return xml.slice(openEnd + 1, end).trim();
  }
  // Missing close tag: stop at </response> if present, else to end.
  const responseClose = lower.lastIndexOf('</response>');
  const end = responseClose !== -1 ? responseClose : xml.length;
  return xml.slice(openEnd + 1, end).trim();
}

/**
 * Incremental parser that emits only the <final_response> content
 */
class StreamingXmlParser {
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
      const titleMatch = this.buffer.match(/<title>([\s\S]*?)<\/title>/);
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
        // Keep tail to catch split tags
        if (this.buffer.length > 120) this.buffer = this.buffer.slice(-120);
        return null;
      }
    }

    const lowerBuf = this.buffer.toLowerCase();
    const endIndex = lowerBuf.indexOf('</final_response');
    const responseEndIndex = lowerBuf.indexOf('</response>');

    // Prefer explicit </final_response>, but if missing and we hit </response>, end there.
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

    // Emit safely while keeping tail
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

/**
 * Unified streaming runner
 * @param {Object} opts
 * @param {'gemini'|'claude'} opts.provider
 * @param {string} opts.model
 * @param {string} opts.promptSource - system prompt text
 * @param {string} opts.payload - user payload (string)
 * @param {Object} opts.config - config object (for tokens, etc.)
 * @param {function} opts.onToken - (text) => void, called with incremental final_response text
 * @param {function} opts.onStartStreaming - () => void, called once when final_response starts
 * @returns agentData + history
 */
export async function streamAgent({
  provider = 'gemini',
  model,
  promptSource,
  payload,
  config = {},
  history = [],
  onToken = () => {},
  onStartStreaming = () => {}
}) {
  const parser = new StreamingXmlParser();
  let rawText = '';
  let started = false;

  const maybeStart = () => {
    if (!started && parser.isStreaming()) {
      started = true;
      onStartStreaming();
    }
  };

  const handleChunk = (text) => {
    if (!text) return;
    rawText += text;
    const newText = parser.processChunk(text);
    if (parser.isStreaming()) maybeStart();
    if (newText) onToken(newText);
  };

  const normalizeOpenAIHistory = (items) => {
    if (!Array.isArray(items)) return [];
    const normalized = [];
    for (const item of items) {
      if (!item) continue;
      // OpenAI format: { role, content }
      if (typeof item?.role === 'string' && typeof item?.content === 'string') {
        const role = item.role === 'model' ? 'assistant' : item.role;
        if (role === 'user' || role === 'assistant' || role === 'developer' || role === 'system') {
          normalized.push({ role, content: item.content });
        }
        continue;
      }
      // Gemini format: { role, parts: [{ text }] }
      if (typeof item?.role === 'string' && Array.isArray(item?.parts)) {
        const text = item.parts.map(p => p?.text).filter(Boolean).join('');
        if (text) {
          const role = item.role === 'model' ? 'assistant' : item.role;
          normalized.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
        }
      }
    }
    return normalized;
  };

  // === Provider specific streaming ===
  if (provider === 'claude') {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const stream = client.messages.stream({
      model,
      system: promptSource,
      messages: [...history, { role: 'user', content: payload }],
      max_tokens: config.agentMaxOutputTokens || 64000,
      temperature: 1
    });
    stream.on('text', handleChunk);
    await stream.finalMessage();
  } else if (provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('Missing OPENAI_API_KEY');
    }
    const client = new OpenAI({ apiKey: config.openaiApiKey });

    const openaiHistory = normalizeOpenAIHistory(history);
    const input = [
      ...(promptSource ? [{ role: 'developer', content: promptSource }] : []),
      ...openaiHistory,
      { role: 'user', content: payload }
    ];

    const stream = client.responses.stream({
      model,
      reasoning: { effort: config.openaiReasoningEffort || 'xhigh' },
      input,
      max_output_tokens: config.agentMaxOutputTokens || 128000,
      temperature: 1
    });

    stream.on('response.output_text.delta', (event) => {
      handleChunk(event?.delta || '');
    });

    await stream.finalResponse();
  } else {
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const safetySettings = [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
    ];

    const response = await client.models.generateContentStream({
      model,
      contents: [...history, { role: 'user', parts: [{ text: payload }] }],
      systemInstruction: { parts: [{ text: promptSource }] },
      safetySettings,
      config: {
        maxOutputTokens: config.agentMaxOutputTokens || 64000,
        temperature: 1,
        thinkingLevel: config.thinkingLevel || 'HIGH',
        mediaResolution: config.mediaResolution || 'MEDIA_RESOLUTION_HIGH'
      }
    });

    for await (const chunk of response) {
      handleChunk(chunk.text || '');
      if (parser.isStreaming()) maybeStart();
      if (parser.isComplete()) break;
    }
  }

  // Final parse
  const rawXml = rawText.trim();
  const xml = extractResponseBlock(rawXml);
  const reflection = extractTagLenient(xml, 'internal_reflection');
  const plan = extractTagLenient(xml, 'action_plan');
  let finalResponse = extractTagLenient(xml, 'final_response');
  let title = extractTagLenient(xml, 'title') || parser.getTitle();

  if (!finalResponse && xml && !xml.toLowerCase().includes('<final_response')) {
    // If no <final_response>, fall back to inner response content
    const inner = xml.replace(/^<response[^>]*>/, '').replace(/<\/response>$/, '').trim();
    if (inner) finalResponse = inner;
  }

  // If still no finalResponse, fall back to accumulated streaming text
  if (!finalResponse) finalResponse = parser.getFullText();
  finalResponse = stripKnownXmlTags(finalResponse || '');

  const assistantContent = provider === 'claude'
    ? { role: 'assistant', content: rawXml }
    : provider === 'openai'
      ? { role: 'assistant', content: rawXml }
      // Gemini expects model role for assistant turns
      : { role: 'model', parts: [{ text: rawXml }] };

  const userContent = provider === 'claude'
    ? { role: 'user', content: payload }
    : provider === 'openai'
      ? { role: 'user', content: payload }
      : { role: 'user', parts: [{ text: payload }] };

  return {
    agentData: {
      reflection,
      plan,
      finalResponse,
      title,
      xml,
      promptPath: null // caller may override
    },
    history: [
      ...history,
      userContent,
      assistantContent
    ]
  };
}
