/**
 * Help.jsx - Ayuda on-demand
 *
 * Aparece con "?". Desaparece con cualquier tecla.
 * Mínima. Clara. Desaparece.
 */

import React from 'react';
import { Box, Text } from 'ink';

const shortcuts = [
  { key: '↑↓', desc: 'navegar' },
  { key: 'Enter', desc: 'abrir / enviar' },
  { key: 'Esc', desc: 'volver' },
  { key: '/', desc: 'buscar' },
  { key: 'd', desc: 'borrar' },
  { key: 'c', desc: 'copiar url' },
  { key: 'q', desc: 'salir' },
];

export default function Help() {
  return (
    <Box flexDirection="column" paddingY={1}>
      {shortcuts.map(({ key, desc }) => (
        <Box key={key} gap={2}>
          <Text color="cyan" bold>{key.padEnd(6)}</Text>
          <Text dimColor>{desc}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor italic>cualquier tecla para cerrar</Text>
      </Box>
    </Box>
  );
}
