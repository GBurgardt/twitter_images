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
import {
  extractResponseBlock,
  extractTagLenient,
  extractTagStrict,
  stripKnownXmlTags,
  StreamingFinalResponseParser
} from './xml.js';

// Back-compat exports used elsewhere in the repo (strict tag extraction).
export function extractTag(xml = '', tag) {
  return extractTagStrict(xml, tag);
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
  const toPositiveInt = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  const parser = new StreamingFinalResponseParser();
  let rawText = '';
  let started = false;
  let openaiUsage = null;
  let openaiModel = null;
  let openaiResponseId = null;

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
    const requested = toPositiveInt(config.agentMaxOutputTokens) ?? 64000;
    const hardCap = 64000; // Claude Opus 4.5 max output tokens (Anthropic API rejects > 64000)
    let maxTokens = Math.min(requested, hardCap);

    const run = async () => {
      const stream = client.messages.stream({
        model,
        system: promptSource,
        messages: [...history, { role: 'user', content: payload }],
        max_tokens: maxTokens,
        temperature: 1
      });
      stream.on('text', handleChunk);
      await stream.finalMessage();
    };

    try {
      await run();
    } catch (err) {
      const msg = err?.error?.error?.message || err?.message || '';
      const m = msg.match(/max_tokens:\s*(\d+)\s*>\s*(\d+)/i);
      const allowed = m ? toPositiveInt(m[2]) : null;
      if (allowed && allowed > 0 && allowed < maxTokens) {
        maxTokens = allowed;
        await run();
      } else {
        throw err;
      }
    }
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

    const final = await stream.finalResponse();
    if (final?.usage) openaiUsage = final.usage;
    if (final?.model) openaiModel = final.model;
    if (final?.id) openaiResponseId = final.id;
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

  const usage = provider === 'openai' ? openaiUsage : null;
  const modelUsed = provider === 'openai' ? (openaiModel || model) : model;
  const responseId = provider === 'openai' ? openaiResponseId : null;

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
    meta: {
      provider,
      model: modelUsed,
      responseId,
      usage
    },
    history: [
      ...history,
      userContent,
      assistantContent
    ]
  };
}
