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
import Markdown from './Markdown.jsx';

/**
 * Format relative date - EN ESPAÑOL
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
 * Detecta si un título es "real" (generado por LLM) o basura (transcripción cortada)
 */
function isRealTitle(title) {
  if (!title || title === 'Untitled') return false;
  const t = title.trim();
  if (t.length < 3) return false;
  // Un buen título tiene máx 8 palabras y no empieza con minúscula típica de transcripción
  const words = t.split(/\s+/);
  if (words.length > 12) return false; // Demasiado largo = probablemente transcripción
  // Si empieza con artículo/pronombre en minúscula y tiene >50 chars, es transcripción
  if (t.length > 50 && /^(the|a|an|i|it|he|she|we|they|yes|no|so|well|essentially|basically|who|what|when|where|why|how|el|la|los|las|un|una|yo|él|ella|es|si|no|bueno|así)/i.test(t)) {
    return false;
  }
  return true;
}

/**
 * Generate a smart fallback title from content
 */
function getDisplayTitle(insight) {
  // Si tiene título REAL (corto, generado por LLM), usarlo
  if (isRealTitle(insight.title)) {
    return insight.title;
  }

  // Fallback: preview del contenido (primera línea del finalResponse)
  const content = insight.finalResponse || '';
  if (content) {
    const firstLine = content.split('\n').find(line => line.trim()) || '';
    const preview = firstLine.slice(0, 50).trim();
    if (preview) {
      return preview + (firstLine.length > 50 ? '…' : '');
    }
  }

  // Último fallback
  return 'Sin título';
}


/**
 * Insight list - with visible selector from the start
 */
function InsightList({ insights, selectedIndex, showFavoritesOnly, searchQuery }) {
  if (!insights.length) {
    return (
      <Box flexDirection="column" paddingY={2} paddingX={2}>
        {searchQuery ? (
          <>
            <Text dimColor>No hay resultados para "{searchQuery}"</Text>
            <Text dimColor>Prueba con otros términos o presiona Esc para limpiar.</Text>
          </>
        ) : showFavoritesOnly ? (
          <>
            <Text dimColor>No hay favoritos guardados.</Text>
            <Text dimColor>Presiona F para ver todos los insights.</Text>
          </>
        ) : (
          <>
            <Text dimColor>No hay insights guardados.</Text>
            <Text dimColor>Copia una URL y ejecuta: twx {'<url>'}</Text>
          </>
        )}
      </Box>
    );
  }

  // Show max 20 items to avoid clutter
  const visibleInsights = insights.slice(0, 20);

  return (
    <Box flexDirection="column">
      {visibleInsights.map((insight, index) => {
        const isSelected = index === selectedIndex;
        const isFavorite = insight.isFavorite;
        const title = getDisplayTitle(insight);
        const date = formatDate(insight.updatedAt || insight.createdAt);

        return (
          <Box key={insight._id.toString()} paddingX={1}>
            {/* Selector minimalista › */}
            <Text color={isSelected ? 'cyan' : 'gray'}>
              {isSelected ? '› ' : '  '}
            </Text>
            {/* Favorite star */}
            {isFavorite && <Text color="#FFD700">★ </Text>}
            {/* Title */}
            <Text
              color={isSelected ? 'white' : undefined}
              bold={isSelected}
            >
              {title.slice(0, 55)}{title.length > 55 ? '…' : ''}
            </Text>
            {/* Date - solo si no está seleccionado */}
            {!isSelected && date && (
              <Text dimColor> · {date}</Text>
            )}
          </Box>
        );
      })}
      {insights.length > 20 && (
        <Box paddingX={1}>
          <Text dimColor>  +{insights.length - 20}</Text>
        </Box>
      )}

      {/* Hints sutiles - solo cuando no hay búsqueda activa */}
      {!searchQuery && (
        <Box paddingX={1} marginTop={1}>
          <Text dimColor>^s ★  ^f filtrar  ? ayuda</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Expanded view of an insight
 */
function InsightView({ insight }) {
  if (!insight) return null;

  const title = getDisplayTitle(insight);
  const content = insight.finalResponse || '';
  const conversations = insight.conversations || [];

  return (
    <Box flexDirection="column" paddingY={1} paddingX={1}>
      {/* Title - visible y claro */}
      <Box marginBottom={1}>
        {insight.isFavorite && <Text color="#FFD700">★ </Text>}
        <Text bold>{title}</Text>
      </Box>

      {/* Main content in papyrus box */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#C9A66B"
        paddingX={2}
        paddingY={1}
      >
        <Markdown>{content || ''}</Markdown>
      </Box>

      {/* Conversations */}
      {conversations.map((conv, index) => (
        <Box key={index} flexDirection="column" marginTop={1} paddingX={1}>
          <Text dimColor>{'─'.repeat(50)}</Text>

          {/* User question */}
          <Box marginTop={1}>
            <Text dimColor italic>Tú: {conv.question}</Text>
          </Box>

          {/* Response */}
          <Box marginTop={1}>
            <Markdown>{conv.answer || ''}</Markdown>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Content - shows list or insight based on state
 * MINIMALISTA: sin header ni footer (todo está en App.jsx)
 */
export default function Content({
  insights,
  selectedIndex,
  expandedInsight,
  searchQuery,
  showFavoritesOnly
}) {
  // Vista expandida de un insight
  if (expandedInsight) {
    return <InsightView insight={expandedInsight} />;
  }

  // Lista de insights
  return (
    <InsightList
      insights={insights}
      selectedIndex={selectedIndex}
      showFavoritesOnly={showFavoritesOnly}
      searchQuery={searchQuery}
    />
  );
}
