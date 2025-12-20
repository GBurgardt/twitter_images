import dotenv from 'dotenv';
import path from 'node:path';
import process from 'node:process';
import { PROJECT_ROOT } from '../paths.js';
import * as ui from '../ui.js';
import * as errors from '../errors.js';
import { isConfigured, runSetup, resetConfig } from '../config.js';
import { parseArgs } from './args.js';
import { showUsage } from './usage.js';
import { handleListCommand, handleShowCommand } from './commands/history.js';
import { handleModelCommand } from './commands/model.js';
import { handleTranscriptCommand } from './commands/transcript.js';
import { handleAnalyzeCommand } from './commands/analyze.js';
import { handleDualCommand } from './commands/dual.js';

dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), override: false });

export async function runCli(argv) {
  silenceGoogleDuplicateKeyWarning();

  const options = parseArgs(argv);

  if (options.verbose) ui.setVerbose(true);

  if (options.configCommand) {
    if (options.configReset) {
      await resetConfig();
      ui.clack.log.success('Configuration reset.');
      return;
    }
    await runSetup({ force: true });
    return;
  }

  if (options.list) {
    await handleListCommand(options);
    return;
  }

  if (options.modelCommand) {
    await handleModelCommand(options.modelValue);
    return;
  }

  if (options.showId) {
    await handleShowCommand(options.showId, options);
    return;
  }

  if (!options.inputPath && !options.url && ui.isInteractive()) {
    await handleListCommand(options);
    return;
  }

  if (!(await isConfigured())) {
    await runSetup();
    return;
  }

  if (options.transcriptOnly) {
    await handleTranscriptCommand(options);
    return;
  }

  if (options.dual) {
    if (!options.inputPath && !options.url) {
      showUsage();
      return;
    }
    await handleDualCommand(options);
    return;
  }

  if (!options.inputPath && !options.url) {
    showUsage();
    return;
  }

  await handleAnalyzeCommand(options);
}

function silenceGoogleDuplicateKeyWarning() {
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => {
    const msg = args[0]?.toString?.() || '';
    if (msg.includes('GOOGLE_API_KEY') || msg.includes('GEMINI_API_KEY')) return;
    originalConsoleWarn.apply(console, args);
  };
}

export async function runCliMain(argv) {
  try {
    await runCli(argv);
  } catch (error) {
    errors.show(error, { verbose: argv.includes('--verbose') });
    process.exit(1);
  }
}
