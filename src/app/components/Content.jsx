/**
 * Content.jsx - Lista o Insight
 *
 * OBVIEDAD es la clave. El usuario debe saber SIEMPRE:
 * - Dónde está
 * - Qué puede hacer
 * - Qué está seleccionado
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Markdown from './Markdown.jsx';
import StreamingText from './StreamingText.jsx';

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
            <Text dimColor>Presiona ^f para ver todos los insights.</Text>
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

  // Show max 12 items - búsqueda es la navegación primaria
  const visibleInsights = insights.slice(0, 12);

  return (
    <Box flexDirection="column">
      {visibleInsights.map((insight, index) => {
        const isSelected = index === selectedIndex;
        const isFavorite = insight.isFavorite;
        const title = getDisplayTitle(insight);
        const date = formatDate(insight.updatedAt || insight.createdAt);
        // Gradiente visual: items lejanos del seleccionado son más dim
        const distance = Math.abs(index - selectedIndex);
        const isFar = distance > 4;

        return (
          <Box key={insight._id.toString()} paddingX={1}>
            {/* Selector minimalista › */}
            <Text color={isSelected ? 'cyan' : 'gray'}>
              {isSelected ? '› ' : '  '}
            </Text>
            {/* Favorite star - siempre visible en seleccionado (affordance) */}
            {isSelected ? (
              <Text color="#FFD700">{isFavorite ? '★ ' : '☆ '}</Text>
            ) : (
              isFavorite && <Text color={isFar ? 'gray' : '#FFD700'}>★ </Text>
            )}
            {/* Title - con gradiente de visibilidad */}
            <Text
              color={isSelected ? 'white' : undefined}
              bold={isSelected}
              dimColor={isFar && !isSelected}
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
      {insights.length > 12 && (
        <Box paddingX={1}>
          <Text dimColor>  +{insights.length - 12}</Text>
        </Box>
      )}

      {/* Hints contextuales - cambian si hay búsqueda */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          {searchQuery
            ? 'esc limpiar  ↵ abrir  ? ayuda'
            : '^s ★  ^f filtrar  escribe buscar  ? ayuda'
          }
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Indicador de espera animado (··· que pulsa)
 */
function WaitingDots() {
  const [dots, setDots] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => d >= 3 ? 1 : d + 1);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return <Text dimColor>{'·'.repeat(dots)}</Text>;
}

/**
 * Cursor parpadeante para streaming
 */
function BlinkingCursor({ color = 'cyan' }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(v => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return <Text color={color}>{visible ? '▍' : ' '}</Text>;
}

/**
 * Expanded view of an insight - AHORA CON SOPORTE PARA STREAMING
 */
function InsightView({ insight, streamingText, isStreaming, isWaiting, streamError }) {
  if (!insight) return null;

  const title = getDisplayTitle(insight);
  const content = insight.finalResponse || '';
  const conversations = insight.conversations || [];

  return (
    <Box flexDirection="column" paddingY={1} paddingX={1}>
      {/* Main content in papyrus box - título incluido */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#C9A66B"
        paddingX={2}
        paddingY={1}
      >
        {/* Título dentro de la caja para cohesión visual */}
        <Box marginBottom={1}>
          {insight.isFavorite && <Text color="#FFD700">★ </Text>}
          <Text bold color="#C9A66B">{title}</Text>
        </Box>
        <Markdown>{content || ''}</Markdown>
      </Box>

      {/* Conversations guardadas - sin separador pesado, solo espacio */}
      {conversations.map((conv, index) => (
        <Box key={index} flexDirection="column" marginTop={2} paddingX={1}>
          {/* User question - estilo dim sin label */}
          <Box>
            <Text dimColor>› {conv.question}</Text>
          </Box>

          {/* Response - espacio sutil antes */}
          <Box marginTop={1}>
            <Markdown>{conv.answer || ''}</Markdown>
          </Box>
        </Box>
      ))}

      {/* === STREAMING DE NUEVA RESPUESTA === */}
      {(isWaiting || isStreaming || streamingText) && (
        <Box flexDirection="column" marginTop={2} paddingX={1}>
          {/* Estado: Esperando (antes de <final_response>) - indicador sutil */}
          {isWaiting && !streamingText && (
            <Box>
              <WaitingDots />
            </Box>
          )}

          {/* Estado: Streameando o completado */}
          {streamingText && (
            <Box marginTop={1} flexDirection="column">
              <Box>
                <Markdown>{streamingText}</Markdown>
                {isStreaming && <BlinkingCursor />}
              </Box>
            </Box>
          )}

          {/* Error durante streaming */}
          {streamError && !streamingText && (
            <Box marginTop={1}>
              <Text color="red">{streamError}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Hints contextuales para insight */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>esc volver  ^s ★  ^y copiar url  ^d borrar</Text>
      </Box>
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
  showFavoritesOnly,
  // Props de streaming
  streamingText,
  isStreaming,
  isWaiting,
  streamError
}) {
  // Vista expandida de un insight
  if (expandedInsight) {
    return (
      <InsightView
        insight={expandedInsight}
        streamingText={streamingText}
        isStreaming={isStreaming}
        isWaiting={isWaiting}
        streamError={streamError}
      />
    );
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
