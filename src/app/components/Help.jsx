/**
 * Help.jsx - On-demand help
 *
 * Appears with "?". Disappears with any key.
 * Organizado por categorías. Minimal. Clear.
 */

import React from 'react';
import { Box, Text } from 'ink';

const sections = [
  {
    name: 'navegar',
    shortcuts: [
      { key: '↑↓', desc: 'mover selección' },
      { key: 'Enter', desc: 'abrir / enviar' },
      { key: 'Esc', desc: 'volver / limpiar' },
    ]
  },
  {
    name: 'acciones',
    shortcuts: [
      { key: '^s', desc: '★ marcar favorito' },
      { key: '^f', desc: 'filtrar favoritos' },
      { key: '^d', desc: 'eliminar insight' },
      { key: '^y', desc: 'copiar url' },
    ]
  },
  {
    name: 'sistema',
    shortcuts: [
      { key: '^c', desc: 'salir' },
    ]
  }
];

export default function Help() {
  return (
    <Box flexDirection="column" paddingY={1}>
      {sections.map((section, sIdx) => (
        <Box key={section.name} flexDirection="column" marginBottom={sIdx < sections.length - 1 ? 1 : 0}>
          <Text dimColor italic>{section.name}</Text>
          {section.shortcuts.map(({ key, desc }) => (
            <Box key={key} paddingLeft={1}>
              <Text color="cyan" bold>{key.padEnd(6)}</Text>
              <Text dimColor>{desc}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>^ = ctrl · cualquier tecla cierra</Text>
      </Box>
    </Box>
  );
}
