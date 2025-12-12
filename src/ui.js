/**
 * UI facade - keep external imports stable (`import * as ui from './ui.js'`)
 * while the implementation stays split into small modules (<250 lines each).
 */

export { clack, setVerbose, debug, spinner } from './ui/debug.js';
export { showResult, showRawResult, showMetaLine, showProgress, showContext } from './ui/output.js';
export { showHistoryItem, showHistoryList } from './ui/history.js';
export { chatPrompt } from './ui/chat.js';
export { confirm, showWelcome, showGoodbye, isInteractive } from './ui/misc.js';

