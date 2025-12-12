import fs from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';
import * as ui from '../ui.js';
import * as errors from '../errors.js';
import { streamAgent } from '../agent/streamAgent.js';
import { extractResponseBlock, extractTagLenient } from '../agent/xml.js';
import { createBoxedStreamer, createSmoothWriter } from './streamBox.js';

/**
 * CLI chat session (multiline input, streaming output).
 *
 * Keeps provider logic stable and lets UI evolve independently:
 * - Input UX lives in `ui.chatPrompt`
 * - Output box UX lives in `cli/streamBox`
 * - Provider streaming logic lives in `agent/streamAgent`
 */
export async function runCliChatSession({
  provider,
  model,
  promptPath,
  promptSource,
  config,
  results,
  options,
  conversationHistory,
  runId,
  buildPayload,
  extractResponseText,
  stripXmlTags,
  maskConfig
}) {
  const providerKey = (provider || '').toString().toLowerCase();

  console.log('');
  console.log('  ¿Qué querés saber?');

  while (true) {
    const input = await ui.chatPrompt();

    if (!input || input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit' || input.toLowerCase() === 'back') {
      break;
    }

    const spin = ui.spinner('Destilando...');

    try {
      const payload = buildPayload({
        results,
        styleKey: options.styleKey,
        preset: '',
        customStyle: input,
        directive: options.directive
      });

      let streamed = false;
      let boxWriter = null;
      let smooth = null;
      let agentData = null;
      let history = null;

      if (maskConfig) {
        ui.debug('Chat stream request:', {
          model,
          payloadLength: payload.length,
          historyLength: (conversationHistory || []).length,
          historyRoles: (conversationHistory || []).map(h => h.role),
          config: maskConfig(config)
        });
      }

      try {
        const streamedResult = await streamAgent({
          provider: providerKey,
          model,
          promptSource,
          payload,
          config,
          history: conversationHistory || [],
          onStartStreaming: () => {
            streamed = true;
            spin.success('');
            boxWriter = createBoxedStreamer(process.stdout, { widthRatio: 0.6 });
            boxWriter.start();
            smooth = createSmoothWriter(boxWriter);
          },
          onToken: (textChunk) => {
            if (!textChunk) return;
            if (!boxWriter) {
              boxWriter = createBoxedStreamer(process.stdout, { widthRatio: 0.6 });
              boxWriter.start();
              smooth = createSmoothWriter(boxWriter);
            }
            smooth.enqueue(textChunk);
          }
        });
        agentData = streamedResult.agentData;
        history = streamedResult.history;
      } catch (err) {
        // Legacy fallback: Gemini no-stream request when streaming fails.
        if (providerKey !== 'gemini') throw err;

        ui.debug('Chat streaming failed, fallback to non-stream:', err?.message, err?.stack);

        const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
        const userContent = { role: 'user', parts: [{ text: payload }] };

        const response = await client.models.generateContent({
          model,
          contents: [...(conversationHistory || []), userContent],
          systemInstruction: { parts: [{ text: promptPath ? await fs.readFile(promptPath, 'utf8') : '' }] },
          config: {
            maxOutputTokens: config.agentMaxOutputTokens || 64000,
            temperature: 1,
            thinkingLevel: config.thinkingLevel || 'HIGH',
            mediaResolution: config.mediaResolution || 'MEDIA_RESOLUTION_HIGH'
          }
        });

        spin.success('');
        const rawXml = extractResponseText(response)?.trim() ?? '';
        const xml = extractResponseBlock(rawXml);
        let finalResponse = '';
        if (xml) {
          finalResponse = extractTagLenient(xml, 'final_response');
          if (!finalResponse && !xml.toLowerCase().includes('<final_response')) {
            finalResponse = xml.replace(/^<response[^>]*>/, '').replace(/<\/response>$/, '').trim();
          }
        } else if (rawXml.length > 0) {
          finalResponse = rawXml;
        }
        agentData = {
          reflection: extractTagLenient(xml, 'internal_reflection'),
          plan: extractTagLenient(xml, 'action_plan'),
          finalResponse,
          title: extractTagLenient(xml, 'title'),
          xml,
          promptPath
        };
        history = [...(conversationHistory || []), userContent, response?.candidates?.[0]?.content].filter(Boolean);
      }

      if (!streamed) {
        spin.success('');
      } else {
        await smooth.flush();
        boxWriter.end();
        if (process.stdout.isTTY) console.log('');
      }

      const cleanResponse = stripXmlTags(agentData?.finalResponse || '');
      if (cleanResponse) {
        if (!streamed) ui.showResult(cleanResponse);
        conversationHistory = history || conversationHistory;

        if (runId) {
          try {
            const { addConversation } = await import('../db.js');
            await addConversation(runId, input, cleanResponse);
            ui.debug('Conversation saved to DB');
          } catch (saveErr) {
            ui.debug('Failed to save conversation:', saveErr.message);
          }
        }
      } else {
        ui.debug('Chat no response to show');
      }

    } catch (error) {
      spin.error('Error');
      ui.debug('Chat error:', error);
      ui.debug('Chat error detail:', {
        error,
        model,
        config: maskConfig ? maskConfig(config) : undefined
      });

      if (error?.status === 500) {
        errors.warn('Server error. Try again.', { verbose: options?.verbose, technical: error.message });
      } else if (error?.status === 429) {
        errors.warn('Rate limit. Wait a moment.', { verbose: options?.verbose, technical: error.message });
      } else {
        errors.warn('Could not respond.', { verbose: options?.verbose, technical: error.message });
      }
    }
  }
}

