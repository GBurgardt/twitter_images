import fs from 'node:fs/promises';
import * as errors from '../errors.js';
import { normalizeProviderName } from './modelSelection.js';
import { normalizeStyle, resolveAgentPromptPath } from './style.js';
import { buildAgentPayload } from '../agent/payload.js';
import { extractResponseText } from '../agent/extractResponseText.js';
import { maskConfig } from '../system/maskConfig.js';
import { stripXmlTags } from '../text/stripXmlTags.js';
import { runCliChatSession } from './chatSession.js';

export async function startConversationLoop({ provider, results, options, config, conversationHistory, runId = null }) {
  const normalizedStyle = normalizeStyle(options.style) || 'bukowski';
  const promptPath = resolveAgentPromptPath(normalizedStyle);
  const promptSource = await fs.readFile(promptPath, 'utf8');
  const providerKey = normalizeProviderName(provider || config.agentProvider || 'openai');

  const modelRaw = (config.agentModel || '').toString();
  const modelLower = modelRaw.toLowerCase();
  const chatModel =
    providerKey === 'claude'
      ? (modelLower.includes('claude') ? modelRaw : 'claude-opus-4.5')
      : providerKey === 'openai'
        ? (modelLower.startsWith('gpt-') || (modelLower.startsWith('o') && !modelLower.startsWith('opus')) ? modelRaw : 'gpt-5.2')
        : (modelLower.includes('gemini') ? modelRaw : 'gemini-3-pro-preview');

  if (providerKey === 'openai' && !config.openaiApiKey) {
    errors.warn('Missing OpenAI API key for chat.', { verbose: options.verbose, technical: 'Set OPENAI_API_KEY or run "twx config".' });
    return;
  }
  if (providerKey === 'claude' && !config.anthropicApiKey) {
    errors.warn('Missing Anthropic/Claude API key for chat.', { verbose: options.verbose, technical: 'Set ANTHROPIC_API_KEY or run "twx config".' });
    return;
  }
  if (providerKey === 'gemini' && !config.geminiApiKey) {
    errors.warn('Missing Gemini API key for chat.', { verbose: options.verbose, technical: 'Set GEMINI_API_KEY or run "twx config".' });
    return;
  }

  await runCliChatSession({
    provider: providerKey,
    model: chatModel,
    promptPath,
    promptSource,
    config,
    results: results || [],
    options: { ...options, styleKey: normalizedStyle },
    conversationHistory: conversationHistory || [],
    runId,
    buildPayload: buildAgentPayload,
    extractResponseText: (resp) => extractResponseText(resp, providerKey),
    stripXmlTags,
    maskConfig
  });
}

