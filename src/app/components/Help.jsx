/**
 * Help.jsx - On-demand help
 *
 * Appears with "?". Disappears with any key.
 * Minimal. Clear. Disappears.
 */

import React from 'react';
import { Box, Text } from 'ink';

const shortcuts = [
  { key: '↑↓', desc: 'navigate' },
  { key: 'Enter', desc: 'open / send' },
  { key: 'Esc', desc: 'back' },
  { key: '/', desc: 'search' },
  { key: 'F', desc: '★ favorite / filter' },
  { key: 'd', desc: 'delete' },
  { key: 'c', desc: 'copy url' },
  { key: 'q', desc: 'quit' },
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
        <Text dimColor italic>any key to close</Text>
      </Box>
    </Box>
  );
}
