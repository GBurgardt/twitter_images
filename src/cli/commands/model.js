import { saveConfig } from '../../config.js';
import { normalizeProviderName, resolveModelSelection } from '../modelSelection.js';
import * as ui from '../../ui.js';

export async function handleModelCommand(value) {
  let raw = (value || '').trim();

  if (!raw) {
    if (!ui.isInteractive()) {
      console.log('\nUsage: twx setmodel <gemini|opus|claude-opus-4-5|gpt-5.2|gpt-5.2-pro|model-id>\n');
      return;
    }

    const picked = await ui.select('Select AI model', [
      { value: 'gpt-5.2', label: 'OpenAI · GPT-5.2 (default)' },
      { value: 'gpt-5.2-pro', label: 'OpenAI · GPT-5.2 Pro' },
      { value: 'claude-opus-4-5', label: 'Claude · Opus 4.5' },
      { value: 'gemini-3-pro-preview', label: 'Gemini · 3 Pro' },
      { value: '__custom__', label: 'Custom model id…' },
    ]);

    if (!picked) return;

    if (picked === '__custom__') {
      const custom = await ui.textInput('Model id', {
        placeholder: 'e.g. claude-opus-4-5, gpt-5.2, gemini-3-pro-preview',
      });
      if (!custom) return;
      raw = custom.trim();
    } else {
      raw = picked;
    }
  }

  const selection = resolveModelSelection(raw);
  const provider = selection?.provider || normalizeProviderName(raw);
  const model = selection?.model || raw;

  const saved = await saveConfig({ agentProvider: provider, agentModel: model });
  if (saved) {
    console.log(`\nAI provider set to ${provider} (model: ${model}).\n`);
    console.log('Defaults: max output tokens 128000, temperature 1, OpenAI reasoning effort xhigh (when using OpenAI).');
  } else {
    console.log('\nCould not save the requested model change.\n');
  }
}
