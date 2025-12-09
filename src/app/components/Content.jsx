/**
 * Content.jsx - Lista o Insight
 *
 * OBVIEDAD es la clave. El usuario debe saber SIEMPRE:
 * - Dónde está
 * - Qué puede hacer
 * - Qué está seleccionado
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
 * Header - siempre visible, orienta al usuario
 */
function Header({ title, count }) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={2} marginBottom={1}>
      <Box flexGrow={1}>
        <Text bold color="cyan">twx</Text>
        {title && (
          <>
            <Text dimColor> · </Text>
            <Text>{title}</Text>
          </>
        )}
      </Box>
      {count !== undefined && (
        <Text dimColor>{count} items</Text>
      )}
    </Box>
  );
}

/**
 * Footer - shortcuts siempre visibles
 */
function Footer({ mode }) {
  const shortcuts = mode === 'list'
    ? [
        { key: '↑↓', label: 'navegar' },
        { key: 'Enter', label: 'abrir' },
        { key: '/', label: 'buscar' },
        { key: 'q', label: 'salir' },
      ]
    : [
        { key: '↑↓', label: 'scroll' },
        { key: 'Esc', label: 'volver' },
        { key: 'd', label: 'borrar' },
      ];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={2} marginTop={1}>
      <Box gap={3}>
        {shortcuts.map(({ key, label }) => (
          <Box key={key} gap={1}>
            <Text color="cyan">[{key}]</Text>
            <Text dimColor>{label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Lista de insights - CON selector visible desde el inicio
 */
function InsightList({ insights, selectedIndex }) {
  if (!insights.length) {
    return (
      <Box flexDirection="column" paddingY={2} paddingX={2}>
        <Text dimColor>No hay insights guardados.</Text>
        <Text dimColor>Copia una URL y ejecuta: twx {'<url>'}</Text>
      </Box>
    );
  }

  // Mostrar máximo 15 items para no saturar
  const visibleInsights = insights.slice(0, 20);

  return (
    <Box flexDirection="column" paddingY={1}>
      {visibleInsights.map((insight, index) => {
        const isSelected = index === selectedIndex;
        // Usar el título de la DB, no el contenido
        const title = insight.title || 'Sin título';
        const date = formatDate(insight.createdAt);

        return (
          <Box key={insight._id.toString()}>
            {/* Indicador de selección - SIEMPRE visible */}
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? ' ▶ ' : '   '}
            </Text>
            {/* Título con highlight si seleccionado */}
            <Text
              backgroundColor={isSelected ? 'blue' : undefined}
              color={isSelected ? 'white' : undefined}
              bold={isSelected}
            >
              {title.slice(0, 55)}{title.length > 55 ? '...' : ''}
            </Text>
            {/* Fecha a la derecha */}
            {!isSelected && date && (
              <Text dimColor> · {date}</Text>
            )}
          </Box>
        );
      })}
      {insights.length > 20 && (
        <Box paddingX={3} marginTop={1}>
          <Text dimColor>... y {insights.length - 20} más</Text>
        </Box>
      )}
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
    <Box flexDirection="column" paddingY={1} paddingX={1}>
      {/* Contenido principal en caja */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#C9A66B"
        paddingX={2}
        paddingY={1}
      >
        <Text>{renderMarkdown(content)}</Text>
      </Box>

      {/* Conversaciones */}
      {conversations.map((conv, index) => (
        <Box key={index} flexDirection="column" marginTop={1} paddingX={1}>
          <Text dimColor>{'─'.repeat(50)}</Text>

          {/* Pregunta del usuario */}
          <Box marginTop={1}>
            <Text dimColor italic>Tú: {conv.question}</Text>
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
 * CON header y footer para orientar al usuario
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
    const title = expandedInsight.title || 'Insight';
    return (
      <Box flexDirection="column">
        <Header title={title} />
        <InsightView insight={expandedInsight} />
        <Footer mode="insight" />
      </Box>
    );
  }

  // Mostrar lista
  return (
    <Box flexDirection="column">
      <Header title={searchMode ? `Buscando: ${searchQuery}` : 'Biblioteca'} count={insights.length} />
      <InsightList insights={insights} selectedIndex={selectedIndex} />
      <Footer mode="list" />
    </Box>
  );
}
