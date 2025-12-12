import process from 'node:process';
import { parseTimecode } from './text.js';
import { normalizeStyle } from './style.js';
import { showUsage } from './usage.js';

export function parseArgs(argv) {
  const options = {
    inputPath: null,
    url: null,
    json: false,
    recursive: true,
    style: null,
    styleFile: null,
    styleText: null,
    mode: null,
    verbose: false,
    list: false,
    listLimit: 10,
    modelCommand: false,
    modelValue: null,
    modelOverride: null,
    showId: null,
    directive: null,
    thread: false,
    clipStart: null,
    clipEnd: null,
    clipRange: null,
    showTranscript: false,
    configCommand: false,
    configReset: false,
    transcriptOnly: false
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === 'transcript' || arg === 'transcribe' || arg === 'trans') {
      options.transcriptOnly = true;
      continue;
    }

    if (arg === 'config') {
      options.configCommand = true;
      continue;
    }
    if (arg === '--reset') {
      options.configReset = true;
      continue;
    }
    if (arg === 'list' || arg === 'history' || arg === '--list' || arg === '-l') {
      options.list = true;
      continue;
    }
    if (arg === '-i' || arg === '--interactive') {
      options.list = true;
      continue;
    }

    if (arg === 'model' || arg === 'setmodel' || arg === 'provider') {
      options.modelCommand = true;
      options.modelValue = argv[++i] || null;
      continue;
    }

    if (arg === 'show' || arg === 'view' || arg === '--show-run') {
      options.showId = argv[++i] || null;
      continue;
    }

    if (arg === '--path' || arg === '-p') {
      options.inputPath = argv[++i];
      continue;
    }
    if (arg === '--url' || arg === '-u') {
      options.url = argv[++i];
      continue;
    }
    if (arg === '--model') {
      options.modelOverride = argv[++i] || null;
      continue;
    }
    if (arg === '--limit') {
      options.listLimit = Number(argv[++i]) || 10;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--no-recursive') {
      options.recursive = false;
      continue;
    }
    if (arg === '--style') {
      options.style = argv[++i];
      continue;
    }
    if (arg === '--style-file') {
      options.styleFile = argv[++i];
      continue;
    }
    if (arg === '--style-text') {
      options.styleText = argv[++i];
      continue;
    }
    if (arg === '--verbose' || arg === '--debug') {
      options.verbose = true;
      continue;
    }
    if (arg === '--transcript' || arg === '--show-transcript') {
      options.showTranscript = true;
      continue;
    }
    if (arg === '--thread') {
      options.thread = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      showUsage();
      process.exit(0);
    }

    if (arg === '--clip' || arg === '--range') {
      const val = argv[++i];
      if (val) {
        const [startRaw, endRaw] = val.split(/[-–]/);
        options.clipStart = parseTimecode(startRaw);
        if (endRaw) options.clipEnd = parseTimecode(endRaw);
      }
      continue;
    }
    if (arg === '--start' || arg === '--from') {
      options.clipStart = parseTimecode(argv[++i]);
      continue;
    }
    if (arg === '--end' || arg === '--to') {
      options.clipEnd = parseTimecode(argv[++i]);
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    positional.push(arg);
  }

  if (options.clipStart != null || options.clipEnd != null) {
    options.clipRange = { start: options.clipStart ?? 0, end: options.clipEnd ?? null };
  }

  if (options.list) {
    const num = positional.find((v) => /^\d+$/.test(v));
    if (num) options.listLimit = Number(num);
    return options;
  }

  if (positional.length > 0) {
    const first = positional[0];

    if (/^[a-f0-9]{24}$/i.test(first)) {
      options.showId = first;
      return options;
    }

    if (/^https?:\/\//i.test(first)) {
      options.url = first;
    } else {
      options.inputPath = first;
    }
  }

  if (positional.length > 1 && !options.style) {
    const maybeStyle = normalizeStyle(positional[1]);
    if (maybeStyle) {
      options.style = maybeStyle;
    } else {
      options.directive = positional[1];
    }
  } else if (positional.length > 1 && !options.directive) {
    options.directive = positional[1];
  }

  if (positional.length > 2 && !options.directive) {
    options.directive = positional[2];
  }

  return options;
}
