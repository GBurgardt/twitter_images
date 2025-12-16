/**
 * Run Insight Agent
 *
 * Orchestrates the AI analysis with elegant streaming output.
 */

import fs from 'node:fs/promises';
import * as ui from '../../ui.js';
import * as errors from '../../errors.js';
import { buildAgentPayload } from '../../agent/payload.js';
import { streamAgent } from '../../agent/streamAgent.js';
import { createBoxedStreamer, createSmoothWriter } from '../streamBox.js';
import { normalizeStyle, resolveAgentPromptPath } from '../style.js';
import { maskConfig } from '../../system/maskConfig.js';
import { resolveAgentModel } from './resolveAgentModel.js';

export async function runInsightAgent({ provider, results, style, config, directive }) {
  const normalizedStyle = normalizeStyle(style) || 'bukowski';
  const promptPath = resolveAgentPromptPath(normalizedStyle);
  const promptSource = await fs.readFile(promptPath, 'utf8');

  const { provider: providerKey, model } = resolveAgentModel({ provider, config });

  const spin = ui.spinner(model ? `Analyzing... (${model})` : 'Analyzing...');

  let payload = '';

  try {
    payload = buildAgentPayload({
      results,
      styleKey: normalizedStyle,
      preset: '',
      customStyle: '',
      directive,
    });

    ui.debug('Agent payload length:', payload.length);
    ui.debug('Agent request meta:', { model, config: maskConfig(config) });

    let streamed = false;
    let boxWriter = null;
    let smooth = null;

    const { agentData, history, meta } = await streamAgent({
      provider: providerKey,
      model,
      promptSource,
      payload,
      config,
      onStartStreaming: () => {
        streamed = true;
        spin.success('');
        boxWriter = createBoxedStreamer(process.stdout, {
          widthRatio: 0.65,
          model: model,
          rawTitle: 'ANALYSIS',
        });
        boxWriter.start();
        smooth = createSmoothWriter(boxWriter);
      },
      onToken: (textChunk) => {
        if (!textChunk) return;
        if (!boxWriter) {
          boxWriter = createBoxedStreamer(process.stdout, {
            widthRatio: 0.65,
            model: model,
            rawTitle: 'ANALYSIS',
          });
          boxWriter.start();
          smooth = createSmoothWriter(boxWriter);
        }
        smooth.enqueue(textChunk);
      },
    });

    if (!streamed) {
      spin.success('');
    } else {
      await smooth.flush();
      boxWriter.end();
      if (process.stdout.isTTY) console.log('');
    }

    agentData.promptPath = promptPath;

    return {
      agentData,
      history,
      streamed,
      meta,
    };
  } catch (error) {
    spin.error('Error');
    ui.debug('Agent error:', error);
    ui.debug('Agent error detail:', { error, model, payloadLength: payload?.length || 0, config: maskConfig(config) });

    if (error?.status === 429 || error?.message?.includes('quota')) {
      throw new errors.HumanError('API rate limit reached.', {
        tip: 'Wait a few minutes before trying again.',
      });
    }

    throw error;
  }
}
