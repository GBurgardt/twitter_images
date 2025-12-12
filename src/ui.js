/**
 * UI Facade
 *
 * Central export point for all UI components.
 * Keep external imports stable while the implementation
 * stays split into small modules.
 */

// Theme & styling
export {
  style,
  colors,
  rgb,
  symbols,
  spacing,
  gradients,
  ansi,
  env,
  brandHeader,
  sectionHeader,
  progressLine,
  statusLine,
  metaLine,
  promptSymbol,
  relativeTime,
  formatNumber,
  truncate,
  truncateWords,
} from './ui/theme.js';

// Debug & logging
export {
  clack,
  setVerbose,
  debug,
  spinner,
  isVerbose,
  log,
} from './ui/debug.js';

// Output rendering
export {
  showResult,
  showRawResult,
  showMetaLine,
  showProgress,
  showContext,
  showSection,
  showKeyValue,
  showList,
  showTip,
  showDivider,
  blank,
} from './ui/output.js';

// History display
export {
  showHistoryItem,
  showHistoryList,
} from './ui/history.js';

// Chat interface
export { chatPrompt } from './ui/chat.js';

// Misc utilities
export {
  confirm,
  textInput,
  select,
  showWelcome,
  showGoodbye,
  intro,
  outro,
  isInteractive,
  getTerminalSize,
  clearScreen,
  clearLine,
  cursorUp,
  cursorDown,
  hideCursor,
  showCursor,
  isCancel,
} from './ui/misc.js';

// Spinner components
export {
  createSpinner,
  createStepSpinner,
  createThinkingSpinner,
  FRAMES as spinnerFrames,
} from './ui/spinner.js';

// Progress components
export {
  createProgressBar,
  createDownloadProgress,
  createStepProgress,
  inlineProgress,
} from './ui/progress.js';

// Box components
export {
  box,
  resultBox,
  infoBox,
  warningBox,
  errorBox,
  successBox,
  divider,
  hr,
} from './ui/boxes.js';
