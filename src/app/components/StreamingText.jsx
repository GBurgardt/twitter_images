/**
 * StreamingText.jsx - Texto con cursor parpadeante
 *
 * El cursor ▍ aparece al final del texto durante el streaming.
 * Parpadea suave (530ms) como un cursor de texto real.
 * Desaparece cuando el streaming termina.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Markdown from './Markdown.jsx';

/**
 * Cursor parpadeante
 */
function BlinkingCursor({ color = 'cyan' }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(v => !v);
    }, 530); // Frecuencia estándar de cursor

    return () => clearInterval(interval);
  }, []);

  return (
    <Text color={color}>{visible ? '▍' : ' '}</Text>
  );
}

/**
 * Indicador de espera (antes de que llegue <final_response>)
 * Solo muestra el cursor parpadeante, sin texto
 */
export function WaitingIndicator() {
  return (
    <Box paddingX={1}>
      <BlinkingCursor />
    </Box>
  );
}

/**
 * Texto que se está streameando
 * Muestra el contenido con un cursor al final
 */
export function StreamingContent({ text, showCursor = true }) {
  if (!text) {
    return showCursor ? <WaitingIndicator /> : null;
  }

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#C9A66B"
        paddingX={2}
        paddingY={1}
      >
        <Box>
          <Markdown>{text}</Markdown>
          {showCursor && <BlinkingCursor />}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Componente principal que maneja los tres estados:
 * 1. isWaiting: Solo cursor (esperando <final_response>)
 * 2. isStreaming: Texto + cursor (streameando contenido)
 * 3. Ninguno: Texto final sin cursor
 */
export default function StreamingText({
  text,
  isWaiting,
  isStreaming,
  error
}) {
  // Estado 1: Esperando (antes de <final_response>)
  if (isWaiting && !text) {
    return <WaitingIndicator />;
  }

  // Estado con error
  if (error && !text) {
    return (
      <Box paddingX={1}>
        <Text color="red">{error}</Text>
      </Box>
    );
  }

  // Estado 2: Streameando (texto + cursor)
  if (isStreaming || isWaiting) {
    return <StreamingContent text={text} showCursor={true} />;
  }

  // Estado 3: Completo (texto sin cursor)
  if (text) {
    return <StreamingContent text={text} showCursor={false} />;
  }

  return null;
}

export { BlinkingCursor };
