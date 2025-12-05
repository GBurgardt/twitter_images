/**
 * Módulo de errores humanos
 *
 * Traduce errores técnicos a mensajes que un humano puede entender.
 * Los detalles técnicos se muestran solo en modo verbose.
 */

import * as clack from '@clack/prompts';

/**
 * Tipos de error conocidos
 */
const ERROR_PATTERNS = [
  // API Keys
  {
    pattern: /MISTRAL_API_KEY|mistral.*api.*key/i,
    message: 'Falta la clave de Mistral para leer imágenes.',
    tip: 'Ejecutá "twx config" para configurar tus claves.'
  },
  {
    pattern: /GEMINI_API_KEY|GOOGLE_API_KEY|gemini.*api.*key/i,
    message: 'Falta la clave de Gemini/Google para el análisis.',
    tip: 'Ejecutá "twx config" para configurar tus claves.'
  },
  {
    pattern: /OPENAI_API_KEY|openai.*api.*key/i,
    message: 'Falta la clave de OpenAI para transcribir audio.',
    tip: 'Ejecutá "twx config" para configurar tus claves.'
  },

  // Network errors
  {
    pattern: /ENOTFOUND|getaddrinfo|DNS/i,
    message: 'No hay conexión a internet.',
    tip: 'Verificá tu conexión y volvé a intentar.'
  },
  {
    pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT/i,
    message: 'No pude conectarme al servidor.',
    tip: 'Puede ser un problema temporal. Intentá de nuevo en unos minutos.'
  },

  // HTTP errors
  {
    pattern: /401|unauthorized/i,
    message: 'La clave API no es válida o expiró.',
    tip: 'Verificá tus claves con "twx config" y actualizalas si es necesario.'
  },
  {
    pattern: /403|forbidden/i,
    message: 'Acceso denegado.',
    tip: 'Es posible que el contenido sea privado o esté restringido.'
  },
  {
    pattern: /404|not found/i,
    message: 'No encontré ese contenido.',
    tip: 'Puede que haya sido eliminado o que la URL esté mal.'
  },
  {
    pattern: /429|rate.?limit|quota|too many requests/i,
    message: 'Demasiadas solicitudes. Alcanzaste el límite.',
    tip: 'Esperá unos minutos antes de volver a intentar.'
  },
  {
    pattern: /500|502|503|504|internal.*server.*error/i,
    message: 'El servidor está teniendo problemas.',
    tip: 'Intentá de nuevo en unos minutos.'
  },

  // File errors
  {
    pattern: /ENOENT|file not found|no such file/i,
    message: 'No encontré el archivo o carpeta.',
    tip: 'Verificá que la ruta sea correcta.'
  },
  {
    pattern: /EACCES|permission denied/i,
    message: 'No tengo permisos para acceder a ese archivo.',
    tip: 'Verificá los permisos del archivo o carpeta.'
  },

  // Media errors
  {
    pattern: /ffmpeg.*not found|ffmpeg is required/i,
    message: 'Necesito ffmpeg para procesar audio/video.',
    tip: 'Instalalo con: brew install ffmpeg (Mac) o apt install ffmpeg (Linux)'
  },
  {
    pattern: /gallery-dl.*not found/i,
    message: 'Necesito gallery-dl para descargar de Twitter.',
    tip: 'Instalalo con: pip install gallery-dl'
  },
  {
    pattern: /yt-dlp.*not found/i,
    message: 'Necesito yt-dlp para descargar de YouTube.',
    tip: 'Instalalo con: pip install yt-dlp'
  },

  // OCR/Transcription errors
  {
    pattern: /ocr.*failed|ocr.*error/i,
    message: 'No pude leer el texto de la imagen.',
    tip: 'La imagen puede estar muy borrosa o no contener texto.'
  },
  {
    pattern: /transcription.*failed|whisper.*error/i,
    message: 'No pude transcribir el audio.',
    tip: 'El audio puede estar muy distorsionado o en silencio.'
  },

  // Agent errors
  {
    pattern: /agent.*failed|generate.*content.*failed/i,
    message: 'El análisis con IA falló.',
    tip: 'Puede ser un problema temporal. Intentá de nuevo.'
  },
  {
    pattern: /invalid.*prompt|content.*policy/i,
    message: 'El contenido fue rechazado por políticas de seguridad.',
    tip: 'El material puede contener contenido que la IA no puede procesar.'
  },

  // Twitter/X specific
  {
    pattern: /tweet.*deleted|status.*unavailable/i,
    message: 'Ese tweet ya no está disponible.',
    tip: 'Puede haber sido eliminado o la cuenta es privada.'
  },
  {
    pattern: /protected.*tweets|private.*account/i,
    message: 'Esa cuenta es privada.',
    tip: 'Solo se puede acceder a contenido de cuentas públicas.'
  },

  // MongoDB
  {
    pattern: /mongo.*connect|mongodb.*error|ECONNREFUSED.*27017/i,
    message: 'No pude conectar con la base de datos.',
    tip: 'Si no necesitás historial, esto no afecta el funcionamiento básico.'
  }
];

/**
 * Traduce un error técnico a un mensaje humano
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

  // Error genérico
  return {
    message: 'Algo salió mal.',
    tip: 'Usá --verbose para ver detalles técnicos.',
    technical: message
  };
}

/**
 * Muestra un error de manera elegante
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
    clack.log.warn('Detalles técnicos:');
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
 * Muestra un warning (no fatal)
 */
export function warn(message, options = {}) {
  const { verbose = false, technical = null } = options;

  clack.log.warn(message);

  if (verbose && technical) {
    console.log(`  (${technical})`);
  }
}

/**
 * Crea un error con mensaje humano
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
 * Wraps una función async para capturar y mostrar errores
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
