/**
 * Help.jsx - On-demand help
 *
 * Appears with "?". Disappears with any key.
 * Minimal. Clear. Disappears.
 */

import React from 'react';
import { Box, Text } from 'ink';

const shortcuts = [
  { key: '↑↓', desc: 'navegar' },
  { key: 'Enter', desc: 'abrir / enviar' },
  { key: 'Esc', desc: 'volver / limpiar' },
  { key: '^s', desc: '★ favorito' },
  { key: '^f', desc: 'filtrar favoritos' },
  { key: '^d', desc: 'eliminar' },
  { key: '^y', desc: 'copiar url' },
  { key: '^c', desc: 'salir' },
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
