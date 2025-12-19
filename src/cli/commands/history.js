import { loadConfig } from '../../config.js';
import * as ui from '../../ui.js';
import * as errors from '../../errors.js';
import { listRuns, getRunById, toggleFavorite } from '../../db.js';
import { normalizeProviderName } from '../modelSelection.js';
import { startConversationLoop } from '../startConversationLoop.js';
import { stripXmlTags } from '../../text/stripXmlTags.js';

export async function handleListCommand(options) {
  try {
    while (true) {
      const limit = options.list
        ? (options.listLimit || 10)
        : options.listLimit === 10
          ? 200
          : (options.listLimit || 200);

      const runs = await listRuns({ limit });
      const selected = await ui.showHistoryList(runs, {
        onToggleFavorite: async (id) => await toggleFavorite(id),
      });

      if (!selected) {
        ui.clack.log.message('Hasta luego.');
        break;
      }

      await handleShowCommand(selected, options);
    }
  } catch (error) {
    errors.show(error, { verbose: options.verbose });
  }
}

export async function handleShowCommand(id, options = {}) {
  try {
    const run = await getRunById(id);
    if (!run) {
      ui.clack.log.error(`Entry not found: ${id}`);
      return;
    }

    ui.showHistoryItem(run, { showTranscript: options.showTranscript });

    const dbConversations = run.conversations || [];
    if (dbConversations.length > 0) {
      console.log('');
      ui.clack.log.info(`${dbConversations.length} previous message${dbConversations.length > 1 ? 's' : ''}`);
      for (const conv of dbConversations) {
        console.log('');
        console.log(`  \x1b[2mYou: ${conv.question}\x1b[0m`);
        console.log('');
        ui.showResult(stripXmlTags(conv.answer || ''), { markdown: false });
      }
    }

    const config = await loadConfig();
    const provider = normalizeProviderName(run.agentProvider || config.agentProvider || 'openai');
    const canChat =
      ui.isInteractive() &&
      (run.finalResponse || run.results?.some((r) => r.text)) &&
      ((provider === 'gemini' && Boolean(config.geminiApiKey)) ||
        (provider === 'openai' && Boolean(config.openaiApiKey)) ||
        (provider === 'claude' && Boolean(config.anthropicApiKey)));

    if (!canChat) return;

    const conversationHistory = buildConversationHistory({ provider, run, dbConversations });
    await startConversationLoop({
      provider,
      results: run.results || [],
      options: { style: run.style, mode: run.mode },
      config,
      conversationHistory,
      runId: run._id
    });
  } catch (error) {
    errors.show(error, { verbose: options.verbose });
  }
}

function buildConversationHistory({ provider, run, dbConversations }) {
  const history = [];

  if (run.finalResponse) {
    if (provider === 'gemini') {
      history.push({ role: 'model', parts: [{ text: run.finalResponse }] });
    } else {
      history.push({ role: 'assistant', content: run.finalResponse });
    }
  }

  for (const conv of dbConversations) {
    if (provider === 'gemini') {
      history.push({ role: 'user', parts: [{ text: conv.question }] });
      if (conv.answer) history.push({ role: 'model', parts: [{ text: conv.answer }] });
    } else {
      history.push({ role: 'user', content: conv.question });
      if (conv.answer) history.push({ role: 'assistant', content: conv.answer });
    }
  }

  return history;
}
