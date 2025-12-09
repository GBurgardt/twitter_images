/**
 * Content.jsx - Lista o Insight
 *
 * No hay transiciones. No hay animaciones.
 * Lista cuando nada está expandido.
 * Insight cuando algo está expandido.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// Configure marked para terminal
marked.use(markedTerminal({
  reflowText: true,
  width: 76
}));

/**
 * Renderiza Markdown a texto con formato terminal
 */
function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text).trim();
  } catch {
    return text;
  }
}

/**
 * Formatea fecha relativa
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return 'ayer';
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/**
 * Lista de insights
 */
function InsightList({ insights, selectedIndex }) {
  if (!insights.length) {
    return (
      <Box flexDirection="column" paddingY={2}>
        <Text dimColor>Copia una URL y vuelve</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      {insights.map((insight, index) => {
        const isSelected = index === selectedIndex;
        const title = insight.title || 'Sin título';

        return (
          <Box key={insight._id.toString()} paddingX={1}>
            <Text
              backgroundColor={isSelected ? 'blue' : undefined}
              color={isSelected ? 'white' : undefined}
            >
              {' '}{title.slice(0, 60)}{title.length > 60 ? '...' : ''}{' '}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Vista expandida de un insight
 */
function InsightView({ insight }) {
  if (!insight) return null;

  const title = insight.title || 'Sin título';
  const content = insight.finalResponse || '';
  const conversations = insight.conversations || [];

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Título */}
      <Box marginBottom={1}>
        <Text bold>{title}</Text>
      </Box>

      {/* Contenido principal */}
      <Box flexDirection="column">
        <Text>{renderMarkdown(content)}</Text>
      </Box>

      {/* Conversaciones */}
      {conversations.map((conv, index) => (
        <Box key={index} flexDirection="column" marginTop={1}>
          <Text dimColor>{'─'.repeat(40)}</Text>

          {/* Pregunta del usuario */}
          <Box marginTop={1}>
            <Text dimColor>{conv.question}</Text>
          </Box>

          {/* Respuesta */}
          <Box marginTop={1}>
            <Text>{renderMarkdown(conv.answer)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Content - muestra lista o insight según estado
 */
export default function Content({
  insights,
  selectedIndex,
  expandedInsight,
  searchMode,
  searchQuery
}) {
  // Si hay insight expandido, mostrarlo
  if (expandedInsight) {
    return <InsightView insight={expandedInsight} />;
  }

  // Mostrar lista
  return (
    <Box flexDirection="column">
      {searchMode && (
        <Box marginBottom={1}>
          <Text dimColor>Buscando: {searchQuery || '...'}</Text>
        </Box>
      )}
      <InsightList insights={insights} selectedIndex={selectedIndex} />
    </Box>
  );
}
