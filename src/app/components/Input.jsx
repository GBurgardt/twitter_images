/**
 * Input.jsx - El cursor
 *
 * Siempre visible. Siempre listo.
 * Sin prompt. Sin decoración. Solo cursor.
 */

import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export default function Input({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  disabled = false
}) {
  if (disabled) {
    return (
      <Box marginTop={1}>
        <Text dimColor>_</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text dimColor>{placeholder}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder=""
      />
    </Box>
  );
}
