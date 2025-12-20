import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
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
import { normalizeStyle, resolveAgentPromptPath } from '../style.js';
import { resolveAgentModel } from '../agent/resolveAgentModel.js';
import { buildAgentPayload } from '../../agent/payload.js';
import { streamAgent } from '../../agent/streamAgent.js';
import { persistRun } from '../persist.js';
import { estimateOpenAICostUSD } from '../../cost.js';
import { stripXmlTags } from '../../text/stripXmlTags.js';
import { addConversation } from '../../db.js';
import { createDualUi } from '../dual/ui.js';

const STYLE_LABELS = {
  bukowski: 'Bukowski',
  musk: 'Elon',
  nunc: 'NUNC',
};

function formatStyleLabel(styleKey) {
  return STYLE_LABELS[styleKey] || styleKey;
}

function resolveDualStyles(raw) {
  const defaults = ['bukowski', 'musk'];
  if (!raw) return defaults;

  const parts = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => normalizeStyle(v) || null)
    .filter(Boolean);

  if (parts.length === 0) return defaults;

  const unique = [];
  for (const key of parts) {
    if (!unique.includes(key)) unique.push(key);
  }

  if (unique.length === 1) {
    const fallback = unique[0] === 'bukowski' ? 'musk' : 'bukowski';
    unique.push(fallback);
  }

  return unique.slice(0, 2);
}

function buildFooterHint() {
  return 'Tab/Opt+Left/Right switch  Enter send  Ctrl+B both  Ctrl+U/D scroll  Ctrl+K/J top/bottom  Ctrl+C quit';
}

async function extractResults({ options, config, openaiClient, onStatus }) {
  const { items: mediaItems, cleanup } = await collectMediaItems(options, config, {
    debug: null,
    HumanError: errors.HumanError,
  });

  if (!mediaItems.length) {
    throw new errors.HumanError('No content found to process.', {
      tip: 'Check that the URL is valid or the folder contains image/audio/video files.',
    });
  }

  const results = [];
  const contextMap = await gatherContextForItems(mediaItems);

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    const absolutePath = path.resolve(item.path);
    const relativePath = path.relative(process.cwd(), absolutePath) || absolutePath;

    const opModel = item.type === 'image' ? config.ocrModel : item.type === 'video' || item.type === 'audio' ? config.transcribeModel : null;
    if (onStatus) onStatus(opModel ? `Processing ${i + 1}/${mediaItems.length} (${opModel})` : `Processing ${i + 1}/${mediaItems.length}`);

    try {
      let text = '';

      if (item.type === 'image') {
        text = await extractTextFromImage({ filePath: absolutePath, config, debug: null, HumanError: errors.HumanError });
      } else if (item.type === 'video' || item.type === 'audio') {
        if (!openaiClient) {
          throw new errors.HumanError('OpenAI API key required for audio/video transcription.', {
            tip: 'Run "twx config" to add your OpenAI key.',
          });
        }
        text = await transcribeMedia({
          openaiClient,
          filePath: absolutePath,
          clipRange: options.clipRange,
          config,
          debug: null,
          HumanError: errors.HumanError,
        });
      } else if (item.type === 'text') {
        text = await readPlainText(absolutePath, item.inlineText);
      }

      const context = contextMap.get(absolutePath) || null;
      results.push({ file: relativePath, type: item.type, text, context });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const context = contextMap.get(absolutePath) || null;
      results.push({ file: relativePath, type: item.type, error: message, context });
    }
  }

  if (cleanup) {
    try {
      await cleanup();
    } catch {
      // ignore cleanup errors
    }
  }

  return results;
}

async function runPaneAnalysis({
  paneState,
  provider,
  model,
  config,
  results,
  directive,
  agentProvider,
  options,
}) {
  const { pane, styleKey, label } = paneState;

  pane.setStatus('Analyzing');
  pane.appendLine('');
  pane.appendLine(`ANALYSIS (${label})`);
  pane.appendLine('');

  const promptPath = resolveAgentPromptPath(styleKey);
  const promptSource = await fs.readFile(promptPath, 'utf8');

  const payload = buildAgentPayload({
    results,
    styleKey,
    preset: '',
    customStyle: '',
    directive,
  });

  let streamed = false;
  const result = await streamAgent({
    provider,
    model,
    promptSource,
    payload,
    config,
    history: [],
    onStartStreaming: () => {
      streamed = true;
    },
    onToken: (textChunk) => {
      if (textChunk) pane.enqueue(textChunk);
    },
  });

  pane.flush();

  if (!streamed && result?.agentData?.finalResponse) {
    pane.appendLine(result.agentData.finalResponse);
  }

  pane.appendLine('');
  pane.appendLine('---');
  pane.appendLine('');

  const costEstimate =
    result?.meta?.provider === 'openai'
      ? estimateOpenAICostUSD({ model: result.meta.model, usage: result.meta.usage })
      : null;

  const savedRun = await persistRun({
    options,
    config,
    results,
    agentData: result.agentData,
    agentMeta: result.meta,
    costEstimate,
    rawMode: false,
    agentProvider,
    styleUsed: styleKey,
  });

  paneState.history = result.history || [];
  paneState.promptSource = promptSource;
  paneState.promptPath = promptPath;
  paneState.runId = savedRun?._id || null;
  paneState.busy = false;
  pane.setStatus('Ready');
}

async function sendChatMessage({ paneState, provider, model, config, results, directive }) {
  const { pane, styleKey, label } = paneState;

  const raw = paneState.pendingInput || '';
  const text = raw.trim();
  paneState.pendingInput = '';

  if (!text) return;
  if (paneState.busy) {
    pane.appendLine('');
    pane.appendLine('[busy] still responding');
    return;
  }

  paneState.busy = true;
  pane.setStatus('Thinking');
  pane.appendLine('');
  pane.appendLine(`You: ${text}`);
  pane.appendLine('');
  pane.appendLine(`${label}:`);
  pane.appendLine('');

  const payload = buildAgentPayload({
    results,
    styleKey,
    preset: '',
    customStyle: text,
    directive,
  });

  let streamed = false;
  const result = await streamAgent({
    provider,
    model,
    promptSource: paneState.promptSource,
    payload,
    config,
    history: paneState.history || [],
    onStartStreaming: () => {
      streamed = true;
    },
    onToken: (textChunk) => {
      if (textChunk) pane.enqueue(textChunk);
    },
  });

  pane.flush();

  if (!streamed && result?.agentData?.finalResponse) {
    pane.appendLine(result.agentData.finalResponse);
  }

  pane.appendLine('');
  paneState.history = result.history || paneState.history;
  paneState.busy = false;
  pane.setStatus('Ready');

  if (paneState.runId) {
    const clean = stripXmlTags(result?.agentData?.finalResponse || '');
    if (clean) await addConversation(paneState.runId, text, clean);
  }
}

export async function handleDualCommand(options) {
  if (!ui.isInteractive()) {
    errors.show(new errors.HumanError('Dual mode requires a TTY.', { tip: 'Run twx in an interactive terminal.' }));
    return;
  }

  const config = await loadConfig();
  const overrideSelection = resolveModelSelection(options.modelOverride);
  const agentProvider = overrideSelection?.provider || normalizeProviderName(config.agentProvider || 'openai');
  const effectiveConfig = overrideSelection?.model ? { ...config, agentModel: overrideSelection.model } : config;
  const { model: agentModel } = resolveAgentModel({ provider: agentProvider, config: effectiveConfig });

  if (!config.mistralApiKey) {
    errors.show(new Error('Missing MISTRAL_API_KEY'));
    return;
  }
  if (agentProvider === 'openai' && !effectiveConfig.openaiApiKey) {
    errors.show(new errors.HumanError('Missing OpenAI API key for analysis.', { tip: 'Run "twx config" to set it.' }));
    return;
  }
  if (agentProvider === 'claude' && !effectiveConfig.anthropicApiKey) {
    errors.show(new errors.HumanError('Missing Anthropic/Claude API key for analysis.', { tip: 'Run "twx config" to set it.' }));
    return;
  }
  if (agentProvider === 'gemini' && !effectiveConfig.geminiApiKey) {
    errors.show(new errors.HumanError('Missing Gemini API key for analysis.', { tip: 'Run "twx config" to set it.' }));
    return;
  }

  const styles = resolveDualStyles(options.dualStyles);
  const leftStyle = styles[0];
  const rightStyle = styles[1];

  const leftLabel = `${formatStyleLabel(leftStyle)} · ${agentModel}`;
  const rightLabel = `${formatStyleLabel(rightStyle)} · ${agentModel}`;

  const dualUi = createDualUi({ leftLabel, rightLabel, footerText: buildFooterHint() });
  const [leftPane, rightPane] = dualUi.panes;

  const paneStates = [
    {
      pane: leftPane,
      styleKey: leftStyle,
      label: formatStyleLabel(leftStyle),
      history: [],
      promptSource: '',
      promptPath: '',
      runId: null,
      busy: true,
      pendingInput: '',
    },
    {
      pane: rightPane,
      styleKey: rightStyle,
      label: formatStyleLabel(rightStyle),
      history: [],
      promptSource: '',
      promptPath: '',
      runId: null,
      busy: true,
      pendingInput: '',
    },
  ];

  let activeIndex = 0;
  let focusLock = false;
  const setActive = (index, { focus = true } = {}) => {
    activeIndex = index;
    paneStates.forEach((state, i) => state.pane.setActive(i === index));
    if (!focus) return;
    const target = paneStates[index].pane.input;
    if (dualUi.screen.focused === target) return;
    if (focusLock) return;
    focusLock = true;
    target.focus();
    focusLock = false;
  };

  const exitDual = () => {
    dualUi.destroy();
    process.exit(0);
  };

  const bindKeys = (target) => {
    target.key(['C-c', 'C-q', 'escape'], exitDual);

    target.key(['tab'], () => setActive(activeIndex === 0 ? 1 : 0));
    target.key(['S-tab'], () => setActive(activeIndex === 0 ? 1 : 0));
    target.key(['C-l', 'M-left'], () => setActive(0));
    target.key(['C-r', 'M-right'], () => setActive(1));

    target.key(['pageup', 'S-up', 'C-u'], () => paneStates[activeIndex].pane.scrollPage(-1));
    target.key(['pagedown', 'S-down', 'C-d'], () => paneStates[activeIndex].pane.scrollPage(1));
    target.key(['home', 'C-k'], () => paneStates[activeIndex].pane.scrollToTop());
    target.key(['end', 'C-j'], () => paneStates[activeIndex].pane.scrollToBottom());
  };

  bindKeys(dualUi.screen);

  dualUi.screen.key(['C-b'], async () => {
    const active = paneStates[activeIndex];
    const value = active.pane.input.getValue().trim();
    if (!value) return;
    active.pane.input.clearValue();
    dualUi.setFooter(buildFooterHint());

    for (const state of paneStates) {
      state.pendingInput = value;
    }
    await Promise.all(paneStates.map((state) => sendChatMessage({
      paneState: state,
      provider: agentProvider,
      model: agentModel,
      config: effectiveConfig,
      results: state.results,
      directive: options.directive,
    })));
    active.pane.input.focus();
    dualUi.setFooter(buildFooterHint());
  });

  for (const state of paneStates) {
    state.pane.input.on('focus', () => {
      const idx = paneStates.indexOf(state);
      if (idx !== -1) setActive(idx, { focus: false });
    });

    bindKeys(state.pane.input);

    state.pane.input.on('submit', async (value) => {
      state.pane.input.clearValue();
      dualUi.setFooter(buildFooterHint());
      state.pendingInput = value || '';
      await sendChatMessage({
        paneState: state,
        provider: agentProvider,
        model: agentModel,
        config: effectiveConfig,
        results: state.results,
        directive: options.directive,
      });
      state.pane.input.focus();
      dualUi.setFooter(buildFooterHint());
    });
  }

  setActive(0);

  try {
    paneStates.forEach((state) => state.pane.setStatus('Reading'));

    const openaiClient = effectiveConfig.openaiApiKey ? new OpenAI({ apiKey: effectiveConfig.openaiApiKey }) : null;
    const results = await extractResults({
      options,
      config: effectiveConfig,
      openaiClient,
      onStatus: (status) => paneStates.forEach((state) => state.pane.setStatus(status)),
    });

    if (!results.some((r) => r.text)) {
      paneStates.forEach((state) => {
        state.pane.appendLine('');
        state.pane.appendLine('No text found to analyze.');
        state.pane.setStatus('Idle');
        state.busy = false;
      });
      return;
    }

    for (const state of paneStates) {
      state.results = results;
      state.busy = true;
    }

    await Promise.all(paneStates.map((state) =>
      runPaneAnalysis({
        paneState: state,
        provider: agentProvider,
        model: agentModel,
        config: effectiveConfig,
        results,
        directive: options.directive,
        agentProvider,
        options,
      })
    ));

    paneStates.forEach((state) => {
      state.pane.appendLine('Chat ready.');
      state.pane.appendLine('');
    });
  } catch (error) {
    dualUi.destroy();
    errors.show(error, { verbose: options.verbose });
  }
}
