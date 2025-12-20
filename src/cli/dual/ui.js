import blessed from 'blessed';

const INPUT_HEIGHT = 3;
const FOOTER_HEIGHT = 1;
const MAX_LOG_CHARS = 200000;
const FLUSH_INTERVAL_MS = 30;

function createPane(screen, requestRender, onStatusChange, { left, width, label, index }) {
  let baseLabel = label || '';
  let status = '';
  let content = '';
  let buffer = '';
  let flushTimer = null;

  const log = blessed.box({
    top: 0,
    left,
    width,
    height: `100%-${INPUT_HEIGHT + FOOTER_HEIGHT}`,
    border: 'line',
    label: baseLabel ? ` ${baseLabel} ` : '',
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    vi: true,
    tags: false,
    scrollbar: {
      ch: ' ',
      track: { bg: 'black' },
      style: { inverse: true },
    },
  });

  const input = blessed.textbox({
    bottom: FOOTER_HEIGHT,
    left,
    width,
    height: INPUT_HEIGHT,
    border: 'line',
    inputOnFocus: true,
    keys: true,
    mouse: true,
    tags: false,
  });

  const updateLabel = () => {
    const statusText = status ? ` · ${status}` : '';
    log.setLabel(baseLabel ? ` ${baseLabel}${statusText} ` : statusText.trim());
  };

  const trimContent = () => {
    if (content.length > MAX_LOG_CHARS) {
      content = content.slice(-MAX_LOG_CHARS);
    }
  };

  const render = () => {
    log.setContent(content);
    log.setScrollPerc(100);
    requestRender();
  };

  const append = (text) => {
    if (!text) return;
    content += text;
    trimContent();
    render();
  };

  const appendLine = (text = '') => {
    append(`${text}\n`);
  };

  const flush = () => {
    if (!buffer) return;
    append(buffer);
    buffer = '';
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const enqueue = (text) => {
    if (!text) return;
    buffer += text;
    if (!flushTimer) {
      flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
    }
  };

  const setStatus = (value) => {
    status = value || '';
    if (typeof onStatusChange === 'function') {
      onStatusChange(index, status);
    } else {
      requestRender();
    }
  };

  const setActive = (active) => {
    const color = active ? 'cyan' : 'gray';
    log.style.border = { fg: color };
    input.style.border = { fg: color };
    requestRender();
  };

  const setLabel = (value) => {
    baseLabel = value || '';
    updateLabel();
    requestRender();
  };

  return {
    log,
    input,
    append,
    appendLine,
    enqueue,
    flush,
    setStatus,
    setActive,
    setLabel,
  };
}

export function createDualUi({ leftLabel, rightLabel, footerText }) {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'twx dual',
  });

  let renderPending = false;
  const requestRender = () => {
    if (renderPending) return;
    renderPending = true;
    setImmediate(() => {
      renderPending = false;
      if (!screen.destroyed) screen.render();
    });
  };

  const gutter = 1;
  const leftWidth = Math.floor((screen.width - gutter) / 2);
  const rightWidth = screen.width - leftWidth - gutter;

  const statuses = ['', ''];
  let baseFooter = footerText || '';

  const updateFooter = () => {
    const leftStatus = statuses[0] ? ` ${statuses[0]}` : ' Ready';
    const rightStatus = statuses[1] ? ` ${statuses[1]}` : ' Ready';
    const leftText = leftLabel ? `${leftLabel}:${leftStatus}` : `Left:${leftStatus}`;
    const rightText = rightLabel ? `${rightLabel}:${rightStatus}` : `Right:${rightStatus}`;
    const hint = baseFooter ? ` | ${baseFooter}` : '';
    footer.setContent(`${leftText} | ${rightText}${hint}`);
    requestRender();
  };

  const onStatusChange = (index, status) => {
    statuses[index] = status || '';
    updateFooter();
  };

  const leftPane = createPane(screen, requestRender, onStatusChange, { left: 0, width: leftWidth, label: leftLabel, index: 0 });
  const rightPane = createPane(screen, requestRender, onStatusChange, { left: leftWidth + gutter, width: rightWidth, label: rightLabel, index: 1 });

  const footer = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: FOOTER_HEIGHT,
    tags: false,
  });

  const setFooter = (text) => {
    baseFooter = text || '';
    updateFooter();
  };

  const layout = () => {
    const leftW = Math.floor((screen.width - gutter) / 2);
    const rightW = screen.width - leftW - gutter;
    const logHeight = Math.max(1, screen.height - INPUT_HEIGHT - FOOTER_HEIGHT);

    leftPane.log.width = leftW;
    leftPane.log.height = logHeight;
    leftPane.input.width = leftW;
    rightPane.log.left = leftW + gutter;
    rightPane.input.left = leftW + gutter;
    rightPane.log.width = rightW;
    rightPane.log.height = logHeight;
    rightPane.input.width = rightW;
    requestRender();
  };

  screen.on('resize', layout);

  screen.append(leftPane.log);
  screen.append(rightPane.log);
  screen.append(leftPane.input);
  screen.append(rightPane.input);
  screen.append(footer);

  const destroy = () => {
    screen.destroy();
  };

  updateFooter();
  layout();

  return {
    screen,
    panes: [leftPane, rightPane],
    setFooter,
    destroy,
  };
}
