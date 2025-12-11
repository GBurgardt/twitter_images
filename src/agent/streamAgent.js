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

/**
 * Simple XML extractor used across the project
 */
export function extractResponseBlock(text = '') {
  const match = text.match(/<response[\s\S]*?<\/response>/i);
  return match ? match[0] : '';
}

export function extractTag(xml = '', tag) {
  if (!xml) return '';
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
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
      const startTag = '<final_response>';
      const startIndex = this.buffer.indexOf(startTag);
      if (startIndex !== -1) {
        this.inFinalResponse = true;
        this.buffer = this.buffer.slice(startIndex + startTag.length);
      } else {
        // Keep tail to catch split tags
        if (this.buffer.length > 80) this.buffer = this.buffer.slice(-80);
        return null;
      }
    }

    const endTag = '</final_response>';
    const endIndex = this.buffer.indexOf(endTag);
    if (endIndex !== -1) {
      const newText = this.buffer.slice(0, endIndex);
      this.extractedText += newText;
      this.complete = true;
      this.buffer = '';
      return newText || null;
    }

    // Emit safely while keeping tail
    const safeLength = Math.max(0, this.buffer.length - 40);
    const newText = this.buffer.slice(0, safeLength);
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
  const reflection = extractTag(xml, 'internal_reflection');
  const plan = extractTag(xml, 'action_plan');
  let finalResponse = extractTag(xml, 'final_response');
  let title = extractTag(xml, 'title') || parser.getTitle();

  if (!finalResponse && xml) {
    // If no <final_response>, fall back to inner response content
    const inner = xml.replace(/^<response[^>]*>/, '').replace(/<\/response>$/, '').trim();
    if (inner) finalResponse = inner;
  }

  // If still no finalResponse, fall back to accumulated streaming text
  if (!finalResponse) finalResponse = parser.getFullText();

  const assistantContent = provider === 'claude'
    ? { role: 'assistant', content: rawXml }
    : { role: 'assistant', parts: [{ text: rawXml }] };

  const userContent = provider === 'claude'
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
