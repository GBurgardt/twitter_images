/**
 * App.jsx - The heart of twx
 *
 * FLUJO INSTANTÁNEO:
 * - En lista: escribir filtra instantáneamente (fuzzy search)
 * - Flechas navegan, Enter abre, Escape limpia/vuelve
 * - En insight: escribir envía pregunta
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import Fuse from 'fuse.js';

import { useInsights } from './hooks/useInsights.js';
import { useAnalyze } from './hooks/useAnalyze.js';
import { useClipboard } from './hooks/useClipboard.js';
import { useStreamingChat } from './hooks/useStreamingChat.js';
import Content from './components/Content.jsx';
import Input from './components/Input.jsx';
import Help from './components/Help.jsx';

// Configuración de Fuse para búsqueda fuzzy
const FUSE_OPTIONS = {
  keys: [
    { name: 'title', weight: 2 },
    { name: 'finalResponse', weight: 1 },
    { name: 'conversations.question', weight: 0.5 },
    { name: 'conversations.answer', weight: 0.5 }
  ],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2
};

/**
 * Detecta si un título es "real" (generado por LLM) o basura (transcripción cortada)
 */
function isRealTitle(title) {
  if (!title || title === 'Untitled') return false;
  const t = title.trim();
  if (t.length < 3) return false;
  const words = t.split(/\s+/);
  if (words.length > 12) return false;
  if (t.length > 50 && /^(the|a|an|i|it|he|she|we|they|yes|no|so|well|essentially|basically|who|what|when|where|why|how|el|la|los|las|un|una|yo|él|ella|es|si|no|bueno|así)/i.test(t)) {
    return false;
  }
  return true;
}

/**
 * Título inteligente para mostrar en header
 */
function getDisplayTitle(insight) {
  if (isRealTitle(insight?.title)) {
    return insight.title.slice(0, 45) + (insight.title.length > 45 ? '…' : '');
  }
  const content = insight?.finalResponse || '';
  if (content) {
    const firstLine = content.split('\n').find(l => l.trim()) || '';
    return firstLine.slice(0, 45) + (firstLine.length > 45 ? '…' : '');
  }
  return 'Sin título';
}

export default function App() {
  const { exit } = useApp();

  // Core state - SIMPLIFICADO: ya no hay searchMode
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [hint, setHint] = useState(null);
  const [firstRun, setFirstRun] = useState(true);

  // Hooks
  const {
    insights,
    loading: insightsLoading,
    refresh,
    addConversation,
    deleteInsight,
    toggleFavorite,
    showFavoritesOnly,
    toggleFavoritesFilter
  } = useInsights();
  const { analyze, loading: analyzing, error: analyzeError } = useAnalyze();
  const { clipboardUrl, checkClipboard } = useClipboard();
  const {
    streamingText,
    isStreaming,
    isWaiting,
    error: streamError,
    sendQuestion,
    reset: resetStreaming
  } = useStreamingChat();

  // Derived state
  const isExpanded = expandedId !== null;
  const currentInsight = isExpanded ? insights.find(i => i._id.toString() === expandedId) : null;

  // Crear índice Fuse cuando cambian los insights
  const fuse = useMemo(() => {
    return new Fuse(insights, FUSE_OPTIONS);
  }, [insights]);

  // Búsqueda fuzzy INSTANTÁNEA - solo cuando NO estamos expandidos
  const filteredInsights = useMemo(() => {
    // Si estamos expandidos, no filtramos (el input es para preguntas)
    if (isExpanded) return insights;

    // Si no hay búsqueda, mostrar todos
    if (!inputValue.trim()) return insights;

    // Búsqueda fuzzy
    const results = fuse.search(inputValue);
    return results.map(r => r.item);
  }, [fuse, inputValue, insights, isExpanded]);

  // Reset selectedIndex cuando cambia el filtro
  useEffect(() => {
    if (selectedIndex >= filteredInsights.length) {
      setSelectedIndex(Math.max(0, filteredInsights.length - 1));
    }
  }, [filteredInsights.length, selectedIndex]);

  // Check clipboard on mount
  useEffect(() => {
    checkClipboard();
  }, []);

  // Show URL hint if clipboard has URL
  useEffect(() => {
    if (clipboardUrl && !isExpanded && !analyzing && !inputValue) {
      const truncated = clipboardUrl.length > 50
        ? clipboardUrl.slice(0, 47) + '...'
        : clipboardUrl;
      setHint({ type: 'url', text: truncated, url: clipboardUrl });

      // Auto-hide after 8 seconds
      const timer = setTimeout(() => {
        setHint(h => h?.type === 'url' ? null : h);
      }, 8000);

      return () => clearTimeout(timer);
    }
  }, [clipboardUrl, isExpanded, analyzing, inputValue]);

  // Show first-run help hint
  useEffect(() => {
    if (firstRun && insights.length > 0) {
      setTimeout(() => {
        setHint({ type: 'help', text: '? ayuda · escribe para buscar' });
        setTimeout(() => {
          setHint(h => h?.type === 'help' ? null : h);
          setFirstRun(false);
        }, 4000);
      }, 1000);
    }
  }, [firstRun, insights.length]);

  // Handle new analysis
  const handleAnalyze = useCallback(async (url) => {
    setHint(null);
    const result = await analyze(url);
    if (result) {
      await refresh();
      // Expand the new insight
      setExpandedId(result._id.toString());
      setSelectedIndex(0);
    }
  }, [analyze, refresh]);

  // Handle sending a question - AHORA CON STREAMING
  const handleSendQuestion = useCallback(async (question) => {
    if (!currentInsight || !question.trim()) return;
    if (isStreaming || isWaiting) return; // No enviar si ya está streameando

    setInputValue('');

    // Usar streaming para la respuesta
    await sendQuestion(currentInsight, question, async () => {
      // Cuando termine el streaming:
      // 1. Refrescar para obtener la conversación guardada en DB
      await refresh();
      // 2. Limpiar el streaming para que no aparezca duplicado
      resetStreaming();
    });
  }, [currentInsight, sendQuestion, refresh, resetStreaming, isStreaming, isWaiting]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!currentInsight) return;
    await deleteInsight(currentInsight._id);
    setExpandedId(null);
    await refresh();
  }, [currentInsight, deleteInsight, refresh]);

  // Handle toggle favorite - el cambio visual ☆/★ ES el feedback, no necesita hint extra
  const handleToggleFavorite = useCallback(async (insightId = null) => {
    const id = insightId || currentInsight?._id;
    if (!id) return;
    await toggleFavorite(id);
    // El ☆/★ en la lista ya muestra el cambio - no hint redundante
  }, [currentInsight, toggleFavorite]);

  // Keyboard handling - CTRL+tecla para acciones, tecla sola para búsqueda
  useInput((input, key) => {
    // Help toggle - ? solo cuando input vacío
    if (input === '?' && !inputValue && !isExpanded) {
      setShowHelp(h => !h);
      return;
    }

    // Close help on any key
    if (showHelp) {
      setShowHelp(false);
      return;
    }

    // Ctrl+Q o Ctrl+C para salir
    if (key.ctrl && (input === 'q' || input === 'c') && !isExpanded) {
      exit();
      return;
    }

    // Escape - limpia input o vuelve atrás
    if (key.escape) {
      if (inputValue) {
        setInputValue('');
      } else if (isExpanded) {
        setExpandedId(null);
        resetStreaming(); // Limpiar estado de streaming al volver
      }
      setHint(null);
      return;
    }

    // URL hint - Enter para analizar
    if (hint?.type === 'url' && !isExpanded && !analyzing && !inputValue) {
      if (key.return) {
        handleAnalyze(hint.url);
        return;
      }
    }

    // Navigation - flechas SIEMPRE funcionan
    if (!isExpanded) {
      if (key.upArrow) {
        setSelectedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(i => Math.min(filteredInsights.length - 1, i + 1));
        return;
      }
    }

    // Enter - abrir insight o enviar pregunta
    if (key.return) {
      if (isExpanded && inputValue.trim()) {
        handleSendQuestion(inputValue);
        setInputValue('');
        return;
      }
      if (!isExpanded && filteredInsights.length > 0) {
        const insight = filteredInsights[selectedIndex];
        if (insight) {
          setExpandedId(insight._id.toString());
          setInputValue('');
          resetStreaming(); // Limpiar estado de streaming al abrir nuevo insight
        }
        return;
      }
    }

    // === CTRL + TECLA = ACCIONES (no interfieren con búsqueda) ===

    // Ctrl+S - Star/favorito del seleccionado (en lista o en insight)
    if (key.ctrl && input === 's') {
      if (isExpanded) {
        handleToggleFavorite();
      } else {
        const insight = filteredInsights[selectedIndex];
        if (insight) {
          handleToggleFavorite(insight._id);
        }
      }
      return;
    }

    // Ctrl+F - Filtrar favoritos (solo en lista)
    if (key.ctrl && input === 'f' && !isExpanded) {
      toggleFavoritesFilter();
      setSelectedIndex(0);
      return;
    }

    // Ctrl+D - Delete (solo en insight expandido)
    if (key.ctrl && input === 'd' && isExpanded) {
      handleDelete();
      return;
    }

    // Ctrl+Y - Copiar URL (solo en insight expandido)
    if (key.ctrl && input === 'y' && isExpanded) {
      if (currentInsight?.source?.url) {
        import('clipboardy').then(({ default: clipboard }) => {
          clipboard.writeSync(currentInsight.source.url);
          setHint({ type: 'copied', text: 'URL copiada' });
          setTimeout(() => setHint(h => h?.type === 'copied' ? null : h), 1500);
        });
      }
      return;
    }

    // Dismiss URL hint cuando el usuario empieza a escribir
    if (hint?.type === 'url' && input && !key.ctrl) {
      setHint(null);
    }
  });

  // Determinar si mostrar el input
  const showInput = !showHelp && !analyzing && !insightsLoading;
  const inputDisabled = analyzing || isStreaming || isWaiting;

  // Render
  return (
    <Box flexDirection="column">
      {/* Help overlay */}
      {showHelp && <Help />}

      {/* Header minimalista - twx con breadcrumb en insight */}
      {!showHelp && (
        <Box paddingX={1}>
          <Text bold color="cyan">twx</Text>
          {isExpanded && currentInsight && (
            <>
              <Text dimColor> › </Text>
              <Text color="white">{getDisplayTitle(currentInsight).slice(0, 35)}{getDisplayTitle(currentInsight).length > 35 ? '…' : ''}</Text>
            </>
          )}
          {!isExpanded && showFavoritesOnly && (
            <>
              <Text dimColor> · </Text>
              <Text color="#FFD700">★ favoritos</Text>
            </>
          )}
        </Box>
      )}

      {/* INPUT ARRIBA - solo en lista (para buscar) */}
      {showInput && !showHelp && !isExpanded && (
        <Box paddingX={1} marginY={1}>
          <Text dimColor>  </Text>
          <Input
            value={inputValue}
            onChange={setInputValue}
            disabled={inputDisabled}
            placeholder={inputValue ? '' : 'buscar...'}
          />
          {/* URL hint inline */}
          {hint?.type === 'url' && !analyzing && !inputValue && (
            <>
              <Text dimColor> · </Text>
              <Text color="green">↵</Text>
              <Text dimColor> {hint.text}</Text>
            </>
          )}
        </Box>
      )}

      {/* Loading state */}
      {(analyzing || insightsLoading) && !showHelp && (
        <Box paddingX={1} marginY={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> {analyzing ? 'Analizando...' : 'Cargando...'}</Text>
        </Box>
      )}

      {/* Error state */}
      {analyzeError && !analyzing && !showHelp && (
        <Box paddingX={1}>
          <Text color="red">{analyzeError}</Text>
        </Box>
      )}

      {/* Feedback hints - solo para acciones con resultado invisible */}
      {hint?.type === 'copied' && (
        <Box paddingX={1}>
          <Text color="green">✓ {hint.text}</Text>
        </Box>
      )}

      {/* Main content */}
      {!analyzing && !insightsLoading && !showHelp && (
        <Content
          insights={filteredInsights}
          selectedIndex={selectedIndex}
          expandedInsight={currentInsight}
          searchQuery={!isExpanded ? inputValue : ''}
          showFavoritesOnly={showFavoritesOnly}
          streamingText={streamingText}
          isStreaming={isStreaming}
          isWaiting={isWaiting}
          streamError={streamError}
        />
      )}

      {/* INPUT ABAJO - solo en chat expandido (para preguntar) */}
      {showInput && !showHelp && isExpanded && (
        <Box paddingX={1} marginY={1}>
          <Text dimColor>› </Text>
          <Input
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleSendQuestion}
            disabled={inputDisabled}
          />
        </Box>
      )}
    </Box>
  );
}
