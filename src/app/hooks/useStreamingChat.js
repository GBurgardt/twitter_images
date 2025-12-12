/**
 * useStreamingChat.js - Hook para chat con streaming
 *
 * Soporta Gemini (generateContentStream) y Claude (messages.stream)
 * Parsea XML en tiempo real para mostrar solo <final_response>
 */

import { useState, useCallback, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../config.js';
import { addConversation as dbAddConversation } from '../../db.js';
import {
  StreamingFinalResponseParser,
  extractResponseBlock,
  extractTagLenient,
  stripKnownXmlTags
} from '../../agent/xml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const AGENT_PROMPT_BUKOWSKI_PATH = path.join(PROJECT_ROOT, 'prompts/agent_prompt_bukowski.txt');

/**
 * Parser de XML incremental para extraer <final_response>
 */
// XML parsing utilities live in `src/agent/xml.js` (shared with the CLI).

/**
 * Construye el payload para el agente
 */
function buildChatPayload(insight, question) {
  const context = `
Contenido original del análisis:
${insight.finalResponse || ''}

Conversaciones previas:
${(insight.conversations || []).map(c => `Usuario: ${c.question}\nRespuesta: ${c.answer}`).join('\n\n')}
`;

  return `
${context}

Nueva pregunta del usuario:
${question}

Responde de forma concisa y directa en español.
CRÍTICO: Cierra TODOS los tags XML. En particular, SIEMPRE cierra <final_response> con </final_response> y termina con </response>. No puede haber texto después de </response>.
FORMATO (obligatorio): En <final_response> escribe SOLO texto plano (sin Markdown). Usa párrafos cortos, saltos de línea, y si hace falta listas usa "•" o numeración "1)". Para URLs escribe "URL: https://..." en línea.
IMPORTANTE: Devuelve el XML con TODOS los tags requeridos: <response><title>...</title><internal_reflection>...</internal_reflection><action_plan>...</action_plan><final_response>...</final_response></response>
`;
}

/**
 * Hook principal para chat con streaming
 */
export function useStreamingChat() {
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false); // Antes de <final_response>
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  /**
   * Envía una pregunta y streamea la respuesta
   */
  const sendQuestion = useCallback(async (insight, question, onComplete) => {
    if (!insight || !question?.trim()) return;

    // Reset estado
    setStreamingText('');
    setIsWaiting(true);
    setIsStreaming(false);
    setError(null);

    const parser = new StreamingFinalResponseParser();
    let fullAnswer = '';
    let rawText = '';
    let hasStartedStreaming = false;
    const debug = process.env.DEBUG === 'true';

    try {
      const config = await loadConfig();
      const providerRaw = (config.agentProvider || 'gemini').toLowerCase();
      const agentProvider =
        providerRaw === 'claude' || providerRaw === 'opus' ? 'claude'
          : providerRaw === 'openai' ? 'openai'
            : 'gemini';

      // Cargar prompt del sistema
      const promptSource = await fs.readFile(AGENT_PROMPT_BUKOWSKI_PATH, 'utf8');
      const payload = buildChatPayload(insight, question);

      if (debug) console.log('[streaming] Starting chat with provider:', agentProvider);

      if (agentProvider === 'claude' && config.anthropicApiKey) {
        // === CLAUDE STREAMING ===
        const client = new Anthropic({ apiKey: config.anthropicApiKey });
        const model = config.agentModel?.includes('claude')
          ? config.agentModel
          : 'claude-opus-4-5-20251101';

        if (debug) console.log('[streaming] Using Claude model:', model);

        const stream = client.messages.stream({
          model,
          system: promptSource,
          messages: [{ role: 'user', content: payload }],
          max_tokens: config.agentMaxOutputTokens || 64000
        });

        // Guardar referencia para poder abortar
        abortRef.current = () => stream.controller?.abort();

        stream.on('text', (text) => {
          rawText += text || '';
          const newText = parser.processChunk(text);

          // Detectar transición a streaming
          if (parser.isStreaming() && !hasStartedStreaming) {
            hasStartedStreaming = true;
            setIsWaiting(false);
            setIsStreaming(true);
          }

          if (newText) {
            fullAnswer = parser.getFullText();
            setStreamingText(fullAnswer);
          }
        });

        await stream.finalMessage();

      } else if (agentProvider === 'openai' && config.openaiApiKey) {
        // === OPENAI STREAMING (Responses API) ===
        const client = new OpenAI({ apiKey: config.openaiApiKey });
        const modelRaw = (config.agentModel || '').toString();
        const modelLower = modelRaw.toLowerCase();
        const model = (modelLower.startsWith('gpt-') || (modelLower.startsWith('o') && !modelLower.startsWith('opus')))
          ? modelRaw
          : 'gpt-5.2';

        if (debug) console.log('[streaming] Using OpenAI model:', model);

        const stream = client.responses.stream({
          model,
          reasoning: { effort: (config.openaiReasoningEffort || 'xhigh').toString().toLowerCase() },
          input: [
            { role: 'developer', content: promptSource },
            { role: 'user', content: payload }
          ],
          max_output_tokens: config.agentMaxOutputTokens || 128000,
          temperature: 1
        });

        abortRef.current = () => stream.controller?.abort();

        stream.on('response.output_text.delta', (event) => {
          const delta = event?.delta || '';
          rawText += delta;
          const newText = parser.processChunk(delta);

          if (parser.isStreaming() && !hasStartedStreaming) {
            hasStartedStreaming = true;
            setIsWaiting(false);
            setIsStreaming(true);
          }

          if (newText) {
            fullAnswer = parser.getFullText();
            setStreamingText(fullAnswer);
          }
        });

        await stream.finalResponse();

      } else if (config.geminiApiKey) {
        // === GEMINI STREAMING ===
        const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
        const model = config.agentModel?.includes('gemini')
          ? config.agentModel
          : 'gemini-2.5-flash';

        if (debug) console.log('[streaming] Using Gemini model:', model);

        const response = await client.models.generateContentStream({
          model,
          contents: [{ role: 'user', parts: [{ text: payload }] }],
          systemInstruction: { parts: [{ text: promptSource }] },
          config: {
            maxOutputTokens: config.agentMaxOutputTokens || 64000,
            temperature: 1
          }
        });

        for await (const chunk of response) {
          const text = chunk.text || '';
          if (!text) continue;

          rawText += text;
          const newText = parser.processChunk(text);

          // Detectar transición a streaming
          if (parser.isStreaming() && !hasStartedStreaming) {
            hasStartedStreaming = true;
            setIsWaiting(false);
            setIsStreaming(true);
          }

          if (newText) {
            fullAnswer = parser.getFullText();
            setStreamingText(fullAnswer);
          }

          if (parser.isComplete()) break;
        }

      } else {
        throw new Error('No hay API key configurada para el proveedor de IA');
      }

      // Asegurar que tenemos el texto completo
      fullAnswer = parser.getFullText();

      // Fallback: si no se extrajo <final_response>, intentar parsear lenient del XML completo
      if (!fullAnswer && rawText) {
        const xml = extractResponseBlock(rawText);
        if (xml) {
          fullAnswer = extractTagLenient(xml, 'final_response');
          if (!fullAnswer && !xml.toLowerCase().includes('<final_response')) {
            fullAnswer = xml.replace(/^<response[^>]*>/i, '').replace(/<\/response>$/i, '').trim();
          }
        } else {
          fullAnswer = rawText.trim();
        }
      }

      fullAnswer = stripKnownXmlTags(fullAnswer || '').trim();
      setStreamingText(fullAnswer);
      setIsStreaming(false);
      setIsWaiting(false);

      if (debug) console.log('[streaming] Complete, answer length:', fullAnswer.length);

      // Guardar en DB
      if (fullAnswer && insight._id) {
        try {
          await dbAddConversation(insight._id, question, fullAnswer);
          if (debug) console.log('[streaming] Conversation saved to DB');
        } catch (saveErr) {
          if (debug) console.log('[streaming] Failed to save conversation:', saveErr.message);
        }
      }

      // Callback de completado
      if (onComplete) {
        onComplete({ answer: fullAnswer, title: parser.getTitle() });
      }

      return fullAnswer;

    } catch (err) {
      // Error - siempre logueamos errores para debugging
      console.error('[streaming] Error:', err.message);
      setError(err.message || 'Error en streaming');
      setIsStreaming(false);
      setIsWaiting(false);

      // Si hay texto parcial, lo mantenemos
      if (fullAnswer) {
        setStreamingText(fullAnswer + '\n\n⚠ Conexión interrumpida');
      }

      return null;
    }
  }, []); // No dependencies - todo el estado se maneja localmente

  /**
   * Aborta el streaming actual
   */
  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setIsStreaming(false);
    setIsWaiting(false);
  }, []);

  /**
   * Limpia el estado
   */
  const reset = useCallback(() => {
    setStreamingText('');
    setIsStreaming(false);
    setIsWaiting(false);
    setError(null);
    abortRef.current = null;
  }, []);

  return {
    streamingText,
    isStreaming,
    isWaiting,
    error,
    sendQuestion,
    abort,
    reset
  };
}
