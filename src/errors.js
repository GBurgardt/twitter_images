/**
 * Human-friendly error module
 *
 * Translates technical errors to human-readable messages.
 * Technical details shown only in verbose mode.
 */

import * as clack from '@clack/prompts';

/**
 * Known error patterns
 */
const ERROR_PATTERNS = [
  // API Keys
  {
    pattern: /MISTRAL_API_KEY|mistral.*api.*key/i,
    message: 'Missing Mistral API key for image reading.',
    tip: 'Run "twx config" to set up your keys.'
  },
  {
    pattern: /GEMINI_API_KEY|GOOGLE_API_KEY|gemini.*api.*key/i,
    message: 'Missing Gemini/Google API key for analysis.',
    tip: 'Run "twx config" to set up your keys.'
  },
  {
    pattern: /OPENAI_API_KEY|openai.*api.*key/i,
    message: 'Missing OpenAI API key for audio transcription.',
    tip: 'Run "twx config" to set up your keys.'
  },

  // Network errors
  {
    pattern: /ENOTFOUND|getaddrinfo|DNS/i,
    message: 'No internet connection.',
    tip: 'Check your connection and try again.'
  },
  {
    pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,
    message: 'Could not connect to server.',
    tip: 'This might be temporary. Try again in a few minutes.'
  },

  // HTTP errors
  {
    pattern: /401|unauthorized/i,
    message: 'API key is invalid or expired.',
    tip: 'Check your keys with "twx config" and update if needed.'
  },
  {
    pattern: /403|forbidden/i,
    message: 'Access denied.',
    tip: 'Content may be private or restricted.'
  },
  {
    pattern: /404|not found/i,
    message: 'Content not found.',
    tip: 'It may have been deleted or the URL is wrong.'
  },
  {
    pattern: /429|rate.?limit|quota|too many requests/i,
    message: 'Rate limit reached.',
    tip: 'Wait a few minutes before trying again.'
  },
  {
    pattern: /500|502|503|504|internal.*server.*error/i,
    message: 'Server is having issues.',
    tip: 'Try again in a few minutes.'
  },

  // File errors
  {
    pattern: /ENOENT|file not found|no such file/i,
    message: 'File or folder not found.',
    tip: 'Check that the path is correct.'
  },
  {
    pattern: /EACCES|permission denied/i,
    message: 'No permission to access that file.',
    tip: 'Check file or folder permissions.'
  },

  // Media errors
  {
    pattern: /ffmpeg.*not found|ffmpeg is required/i,
    message: 'ffmpeg is required for audio/video processing.',
    tip: 'Install with: brew install ffmpeg (Mac) or apt install ffmpeg (Linux)'
  },
  {
    pattern: /gallery-dl.*not found/i,
    message: 'gallery-dl is required for Twitter downloads.',
    tip: 'Install with: pip install gallery-dl'
  },
  {
    pattern: /yt-dlp.*not found/i,
    message: 'yt-dlp is required for YouTube downloads.',
    tip: 'Install with: pip install yt-dlp'
  },

  // OCR/Transcription errors
  {
    pattern: /ocr.*failed|ocr.*error/i,
    message: 'Could not read text from image.',
    tip: 'Image may be too blurry or contain no text.'
  },
  {
    pattern: /transcription.*failed|whisper.*error/i,
    message: 'Could not transcribe audio.',
    tip: 'Audio may be too distorted or silent.'
  },

  // Agent errors
  {
    pattern: /agent.*failed|generate.*content.*failed/i,
    message: 'AI analysis failed.',
    tip: 'This might be temporary. Try again.'
  },
  {
    pattern: /invalid.*prompt|content.*policy/i,
    message: 'Content rejected by safety policies.',
    tip: 'The material may contain content the AI cannot process.'
  },

  // Twitter/X specific
  {
    pattern: /tweet.*deleted|status.*unavailable/i,
    message: 'That tweet is no longer available.',
    tip: 'It may have been deleted or the account is private.'
  },
  {
    pattern: /protected.*tweets|private.*account/i,
    message: 'That account is private.',
    tip: 'Only public content can be accessed.'
  },

  // MongoDB
  {
    pattern: /mongo.*connect|mongodb.*error|ECONNREFUSED.*27017/i,
    message: 'Could not connect to database.',
    tip: 'If you don\'t need history, this won\'t affect basic functionality.'
  }
];

/**
 * Translate technical error to human message
 */
export function humanize(error) {
  const message = error?.message || error?.toString?.() || String(error);

  for (const { pattern, message: humanMessage, tip } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return {
        message: humanMessage,
        tip,
        technical: message
      };
    }
  }

  // Generic error
  return {
    message: 'Something went wrong.',
    tip: 'Use --verbose for technical details.',
    technical: message
  };
}

/**
 * Show error elegantly
 */
export function show(error, options = {}) {
  const { verbose = false } = options;
  const humanized = humanize(error);

  console.log('');
  clack.log.error(humanized.message);

  if (humanized.tip) {
    clack.log.info(`Tip: ${humanized.tip}`);
  }

  if (verbose && humanized.technical) {
    console.log('');
    clack.log.warn('Technical details:');
    console.log(`  ${humanized.technical}`);

    if (error?.stack) {
      console.log('');
      console.log('  Stack trace:');
      const stackLines = error.stack.split('\n').slice(1, 6);
      for (const line of stackLines) {
        console.log(`  ${line.trim()}`);
      }
    }
  }

  console.log('');
}

/**
 * Show warning (non-fatal)
 */
export function warn(message, options = {}) {
  const { verbose = false, technical = null } = options;

  clack.log.warn(message);

  if (verbose && technical) {
    console.log(`  (${technical})`);
  }
}

/**
 * Create error with human message
 */
export class HumanError extends Error {
  constructor(humanMessage, options = {}) {
    super(humanMessage);
    this.name = 'HumanError';
    this.tip = options.tip || null;
    this.technical = options.technical || null;
  }
}

/**
 * Wrap async function to catch and show errors
 */
export function withErrorHandling(fn, options = {}) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      show(error, options);

      if (options.exit !== false) {
        process.exit(1);
      }

      throw error;
    }
  };
}
