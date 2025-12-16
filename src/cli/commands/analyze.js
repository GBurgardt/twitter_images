import path from 'node:path';
import process from 'node:process';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as ui from '../../ui.js';
import * as errors from '../../errors.js';
import { loadConfig } from '../../config.js';
import { collectMediaItems } from '../../media/collect.js';
import { gatherContextForItems } from '../../media/context.js';
import { extractTextFromImage } from '../../media/ocr.js';
import { transcribeMedia } from '../../media/transcribe.js';
import { readPlainText } from '../../media/readPlainText.js';
import { normalizeProviderName, resolveModelSelection } from '../modelSelection.js';
import { normalizeStyle } from '../style.js';
import { runInsightAgent } from '../agent/runInsightAgent.js';
import { persistRun } from '../persist.js';
import { estimateOpenAICostUSD, formatUSD } from '../../cost.js';
import { stripXmlTags } from '../../text/stripXmlTags.js';
import { maskConfig } from '../../system/maskConfig.js';
import { resolveAgentModel } from '../agent/resolveAgentModel.js';

export async function handleAnalyzeCommand(options) {
  const config = await loadConfig();
  const overrideSelection = resolveModelSelection(options.modelOverride);
  const agentProvider = overrideSelection?.provider || normalizeProviderName(config.agentProvider || 'openai');
  const effectiveConfig = overrideSelection?.model ? { ...config, agentModel: overrideSelection.model } : config;
  const { model: agentModel } = resolveAgentModel({ provider: agentProvider, config: effectiveConfig });

  ui.debug('Config loaded:', maskConfig(config));
  if (overrideSelection) ui.debug('Model override:', overrideSelection);
  ui.debug('Options:', options);

  if (!config.mistralApiKey) {
    errors.show(new Error('Missing MISTRAL_API_KEY'));
    return;
  }

  const geminiClient = effectiveConfig.geminiApiKey ? new GoogleGenAI({ apiKey: effectiveConfig.geminiApiKey }) : null;
  const anthropicClient = effectiveConfig.anthropicApiKey ? new Anthropic({ apiKey: effectiveConfig.anthropicApiKey }) : null;
  const openaiClient = effectiveConfig.openaiApiKey ? new OpenAI({ apiKey: effectiveConfig.openaiApiKey }) : null;

  const agentAvailable =
    agentProvider === 'claude' ? Boolean(anthropicClient) : agentProvider === 'openai' ? Boolean(openaiClient) : Boolean(geminiClient);

  const spin = ui.spinner(agentModel ? `Reading... (${agentModel})` : 'Reading...');

  try {
    const { items: mediaItems, cleanup } = await collectMediaItems(options, config, {
      debug: ui.debug,
      HumanError: errors.HumanError
    });

    if (!mediaItems.length) {
      spin.error('No content');
      errors.show(
        new errors.HumanError('No content found to process.', {
          tip: 'Check that the URL is valid or the folder contains image/audio/video files.'
        })
      );
      return;
    }

    ui.debug('Media items:', mediaItems.map((i) => i.path));

    const results = [];
    const contextMap = await gatherContextForItems(mediaItems);

    for (let i = 0; i < mediaItems.length; i++) {
      const item = mediaItems[i];
      const absolutePath = path.resolve(item.path);
      const relativePath = path.relative(process.cwd(), absolutePath) || absolutePath;

      const opModel = item.type === 'image' ? config.ocrModel : item.type === 'video' || item.type === 'audio' ? config.transcribeModel : null;
      spin.update(opModel ? `Processing ${i + 1}/${mediaItems.length}... (${opModel})` : `Processing ${i + 1}/${mediaItems.length}...`);
      ui.debug('Processing:', relativePath, 'type:', item.type);

      try {
        let text = '';

        if (item.type === 'image') {
          text = await extractTextFromImage({ filePath: absolutePath, config, debug: ui.debug, HumanError: errors.HumanError });
        } else if (item.type === 'video' || item.type === 'audio') {
          if (!openaiClient) {
            throw new errors.HumanError('OpenAI API key required for audio/video transcription.', {
              tip: 'Run "twx config" to add your OpenAI key.'
            });
          }
          text = await transcribeMedia({
            openaiClient,
            filePath: absolutePath,
            clipRange: options.clipRange,
            config,
            debug: ui.debug,
            HumanError: errors.HumanError
          });
        } else if (item.type === 'text') {
          text = await readPlainText(absolutePath, item.inlineText);
        }

        const context = contextMap.get(absolutePath) || null;
        results.push({ file: relativePath, type: item.type, text, context });
        ui.debug('Extracted:', { file: relativePath, chars: text?.length || 0 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const context = contextMap.get(absolutePath) || null;
        results.push({ file: relativePath, type: item.type, error: message, context });
        ui.debug('Error processing:', relativePath, message);
      }
    }

    if (cleanup) {
      try {
        await cleanup();
      } catch (e) {
        ui.debug('Cleanup error:', e);
      }
    }

    spin.success('');

    const normalizedStyle = normalizeStyle(options.style) || 'bukowski';

    let agentData = null;
    let conversationHistory = [];
    let agentMeta = null;
    let costEstimate = null;

    if (results.some((r) => r.text) && agentAvailable) {
      const agentResult = await runInsightAgent({
        provider: agentProvider,
        results,
        style: normalizedStyle,
        config: effectiveConfig,
        directive: options.directive
      });

      if (agentResult) {
        agentData = agentResult.agentData;
        conversationHistory = agentResult.history || [];
        agentMeta = agentResult.meta || null;
        costEstimate =
          agentResult.meta?.provider === 'openai'
            ? estimateOpenAICostUSD({ model: agentResult.meta.model, usage: agentResult.meta.usage })
            : null;

        if (agentData?.finalResponse && !agentResult.streamed) {
          ui.showResult(stripXmlTags(agentData.finalResponse), { title: agentData.title || null, model: agentResult.meta?.model || null });
        }

        if (process.stdout.isTTY && costEstimate) {
          const t = costEstimate.tokens;
          const costText = `${formatUSD(costEstimate.totalUSD)} · in ${t.input}${t.cached_input ? ` (cached ${t.cached_input})` : ''} · out ${t.output}${
            t.reasoning ? ` (reason ${t.reasoning})` : ''
          }`;
          ui.showMetaLine(`cost ${costText}`);
        }
      }
    } else if (results.some((r) => r.text) && !agentAvailable) {
      const providerName = agentProvider === 'claude' ? 'Anthropic/Claude' : agentProvider === 'openai' ? 'OpenAI' : 'Gemini';
      errors.warn(`No ${providerName} key, cannot run AI analysis.`, {
        verbose: options.verbose,
        technical: `Add the missing API key or switch provider with "twx setmodel <gemini|opus|gpt-5.2>"`
      });

      const combined = results
        .filter((r) => r.text)
        .map((r) => r.text)
        .join('\n\n');
      if (combined) ui.showRawResult(combined);
    }

    const savedRun = await persistRun({
      options,
      config: effectiveConfig,
      results,
      agentData,
      agentMeta,
      costEstimate,
      rawMode: false,
      agentProvider,
      styleUsed: normalizedStyle
    });

    const canChat =
      ui.isInteractive() &&
      agentData?.finalResponse &&
      ((agentProvider === 'gemini' && geminiClient) || (agentProvider === 'openai' && openaiClient) || (agentProvider === 'claude' && anthropicClient));

    if (canChat) {
      const { startConversationLoop } = await import('../startConversationLoop.js');
      await startConversationLoop({
        provider: agentProvider,
        results,
        options,
        config: effectiveConfig,
        conversationHistory,
        runId: savedRun?._id || null
      });
    }
  } catch (error) {
    spin.error('Error');
    errors.show(error, { verbose: options.verbose });
    process.exit(1);
  }
}
