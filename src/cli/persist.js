import path from 'node:path';
import * as ui from '../ui.js';
import { saveRun, buildAutoTitle } from '../db.js';
import { sanitizeTitle } from './text.js';

export async function persistRun({ options, config, results, agentData, agentMeta = null, costEstimate = null, rawMode, agentProvider, styleUsed }) {
  try {
    const doc = {
      source: { url: options.url || null, path: options.inputPath || null },
      mode: options.mode || config.mode,
      style: styleUsed || 'bukowski',
      ocrModel: config.ocrModel,
      agentProvider: agentProvider || config.agentProvider,
      agentModel: config.agentModel,
      ai: {
        provider: agentMeta?.provider || agentProvider || config.agentProvider,
        model: agentMeta?.model || config.agentModel,
        responseId: agentMeta?.responseId || null,
        usage: agentMeta?.usage || null,
        costUSD: costEstimate?.totalUSD ?? null
      },
      whisperModel: config.transcribeModel,
      mediaResolution: config.mediaResolution,
      thinkingLevel: config.thinkingLevel,
      promptName: agentData?.promptPath ? path.basename(agentData.promptPath) : null,
      title: sanitizeTitle(agentData?.title) || buildAutoTitle({ results, fallback: options.url || options.inputPath || '' }),
      reflection: agentData?.reflection || null,
      actionPlan: agentData?.plan || null,
      finalResponse: agentData?.finalResponse || null,
      xml: agentData?.xml || null,
      results,
      metadata: { rawMode }
    };

    const saved = await saveRun(doc);
    ui.debug('Run persisted');
    return saved;
  } catch (error) {
    ui.debug('Persist error:', error.message);
    return null;
  }
}

