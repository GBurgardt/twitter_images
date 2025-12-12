import { saveConfig } from '../../config.js';
import { normalizeProviderName, resolveModelSelection } from '../modelSelection.js';

export async function handleModelCommand(value) {
  const raw = (value || '').trim();

  if (!raw) {
    console.log('\nUsage: twx setmodel <gemini|opus|gpt-5.2|gpt-5.2-pro|model-id>\n');
    return;
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

