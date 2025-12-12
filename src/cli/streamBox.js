const ANSI_RESET = '\x1b[0m';

function createAnsiColor({ fg, bg }) {
  const parts = [];
  if (fg) parts.push(`38;2;${fg[0]};${fg[1]};${fg[2]}`);
  if (bg) parts.push(`48;2;${bg[0]};${bg[1]};${bg[2]}`);
  if (!parts.length) return '';
  return `\x1b[${parts.join(';')}m`;
}

export function createBoxedStreamer(stdout, opts = {}) {
  const cols = stdout?.columns || 80;
  const innerWidth = Math.max(40, Math.floor(cols * (opts.widthRatio || 0.6)));
  const contentWidth = Math.max(10, innerWidth - 2);
  const marginSize = Math.max(0, Math.floor((cols - innerWidth - 2) / 2));
  const margin = ' '.repeat(marginSize);
  let lineLen = 0;
  let lineOpen = false;

  const borderColor = opts.fgColor || [230, 230, 230];
  const textColorArr = opts.textColor || [240, 240, 240];
  const bgColor = opts.bgColor || [18, 18, 18];
  const borderAnsi = createAnsiColor({ fg: borderColor, bg: bgColor });
  const textAnsi = createAnsiColor({ fg: textColorArr, bg: bgColor });

  const writeTop = () => {
    stdout.write(`\n${margin}${borderAnsi}┌${'─'.repeat(innerWidth)}┐${ANSI_RESET}\n`);
  };

  const writeBottom = () => {
    stdout.write(`${margin}${borderAnsi}└${'─'.repeat(innerWidth)}┘${ANSI_RESET}\n`);
  };

  const openLine = () => {
    stdout.write(`${margin}${borderAnsi}│ ${textAnsi}`);
    lineOpen = true;
    lineLen = 0;
  };

  const closeLine = () => {
    const pad = Math.max(0, contentWidth - lineLen);
    stdout.write(`${' '.repeat(pad)} ${borderAnsi}│${ANSI_RESET}\n`);
    lineOpen = false;
    lineLen = 0;
  };

  const writeToken = (token) => {
    if (!token) return;

    if (token === '\n') {
      if (!lineOpen) openLine();
      closeLine();
      return;
    }

    if (token.length > contentWidth) {
      let remaining = token;
      while (remaining.length) {
        const slice = remaining.slice(0, contentWidth - lineLen);
        writeToken(slice);
        remaining = remaining.slice(slice.length);
      }
      return;
    }

    if (!lineOpen) openLine();
    if (lineLen + token.length > contentWidth && lineLen > 0) {
      closeLine();
      openLine();
    }

    stdout.write(token);
    lineLen += token.length;
  };

  const end = () => {
    if (lineOpen) closeLine();
    writeBottom();
  };

  return { start: writeTop, writeToken, end };
}

export function createSmoothWriter(writer, { delayMs = 1 } = {}) {
  let pending = Promise.resolve();

  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  const enqueue = (chunk) => {
    if (!chunk) return pending;
    pending = pending.then(async () => {
      const tokens = chunk.match(/(\s+|[^\s]+)/g) || [];
      for (const token of tokens) {
        for (const ch of token) {
          writer.writeToken(ch);
          if (delayMs > 0) await sleep(delayMs);
        }
      }
    });
    return pending;
  };

  const flush = () => pending;
  return { enqueue, flush };
}

