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

  // Handle sending a question
  const handleSendQuestion = useCallback(async (question) => {
    if (!currentInsight || !question.trim()) return;

    setInputValue('');
    await addConversation(currentInsight._id, question);
    await refresh();
  }, [currentInsight, addConversation, refresh]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!currentInsight) return;
    await deleteInsight(currentInsight._id);
    setExpandedId(null);
    await refresh();
  }, [currentInsight, deleteInsight, refresh]);

  // Handle toggle favorite
  const handleToggleFavorite = useCallback(async (insightId = null) => {
    const id = insightId || currentInsight?._id;
    if (!id) return;

    const isFav = await toggleFavorite(id);
    if (isFav !== null) {
      const msg = isFav ? '★ Favorito' : '☆ Quitado de favoritos';
      setHint({ type: 'favorite', text: msg });
      setTimeout(() => setHint(h => h?.type === 'favorite' ? null : h), 1500);
    }
  }, [currentInsight, toggleFavorite]);

  // Keyboard handling
  useInput((input, key) => {
    // Help toggle
    if (input === '?' && !inputValue) {
      setShowHelp(h => !h);
      return;
    }

    // Close help on any key
    if (showHelp) {
      setShowHelp(false);
      return;
    }

    // Quit - solo si no hay input
    if (input === 'q' && !inputValue && !isExpanded) {
      exit();
      return;
    }

    // Escape - limpia input o vuelve atrás
    if (key.escape) {
      if (inputValue) {
        // Primero limpiar el input
        setInputValue('');
      } else if (isExpanded) {
        // Luego cerrar el insight
        setExpandedId(null);
      }
      setHint(null);
      return;
    }

    // When hint is showing and not expanded
    if (hint?.type === 'url' && !isExpanded && !analyzing && !inputValue) {
      if (key.return) {
        handleAnalyze(hint.url);
        return;
      }
      // Cualquier tecla de texto dismissea el hint y empieza búsqueda
      if (input && input !== '?' && input !== 'q') {
        setHint(null);
        // La letra se agregará al input por el componente Input
      }
    }

    // Navigation in list - SIEMPRE funciona con flechas
    if (!isExpanded) {
      if (key.upArrow) {
        setSelectedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(i => Math.min(filteredInsights.length - 1, i + 1));
        return;
      }
      // Enter abre el seleccionado
      if (key.return && filteredInsights.length > 0 && !inputValue) {
        const insight = filteredInsights[selectedIndex];
        if (insight) {
          setExpandedId(insight._id.toString());
          setInputValue('');
        }
        return;
      }
    }

    // Delete insight
    if (input === 'd' && isExpanded && !inputValue) {
      handleDelete();
      return;
    }

    // Copy URL
    if (input === 'c' && isExpanded && !inputValue) {
      if (currentInsight?.source?.url) {
        import('clipboardy').then(({ default: clipboard }) => {
          clipboard.writeSync(currentInsight.source.url);
          setHint({ type: 'copied', text: 'Copiado' });
          setTimeout(() => setHint(h => h?.type === 'copied' ? null : h), 1500);
        });
      }
      return;
    }

    // Toggle favorite (F key)
    if ((input === 'f' || input === 'F') && !inputValue) {
      if (isExpanded) {
        // Toggle favorito del insight actual
        handleToggleFavorite();
      } else {
        // Toggle filtro de favoritos en la lista
        toggleFavoritesFilter();
        setSelectedIndex(0); // Reset selection
      }
      return;
    }
  });

  // Handle input submit
  const handleInputSubmit = useCallback((value) => {
    if (isExpanded && value.trim()) {
      // En vista expandida, enviar pregunta
      handleSendQuestion(value);
    } else if (!isExpanded && filteredInsights.length > 0) {
      // En lista con búsqueda, abrir el primer resultado
      const insight = filteredInsights[selectedIndex] || filteredInsights[0];
      if (insight) {
        setExpandedId(insight._id.toString());
        setInputValue('');
      }
    }
  }, [isExpanded, filteredInsights, selectedIndex, handleSendQuestion]);

  // Determinar si mostrar el input y qué placeholder usar
  const showInput = !showHelp && !analyzing && !insightsLoading;
  const inputPlaceholder = isExpanded ? '' : '';
  const inputPrefix = isExpanded ? '› ' : '🔍 ';

  // Render
  return (
    <Box flexDirection="column">
      {/* Help overlay */}
      {showHelp && <Help />}

      {/* Header minimalista - solo twx */}
      {!showHelp && (
        <Box paddingX={1}>
          <Text bold color="cyan">twx</Text>
          {!isExpanded && showFavoritesOnly && (
            <>
              <Text dimColor> · </Text>
              <Text color="#FFD700">★ favoritos</Text>
            </>
          )}
        </Box>
      )}

      {/* INPUT PRIMERO - Search-first experience */}
      {showInput && !showHelp && (
        <Box paddingX={1} marginY={1}>
          <Text color="cyan">{inputPrefix}</Text>
          <Input
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleInputSubmit}
            placeholder={inputPlaceholder}
            disabled={analyzing}
          />
          {/* URL hint inline */}
          {hint?.type === 'url' && !isExpanded && !analyzing && !inputValue && (
            <>
              <Text dimColor> · </Text>
              <Text color="green">[Enter]</Text>
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

      {/* Feedback hints */}
      {hint?.type === 'copied' && (
        <Box paddingX={1}>
          <Text color="green">✓ {hint.text}</Text>
        </Box>
      )}
      {hint?.type === 'favorite' && (
        <Box paddingX={1}>
          <Text color="yellow">{hint.text}</Text>
        </Box>
      )}

      {/* Main content - DESPUÉS del input */}
      {!analyzing && !insightsLoading && !showHelp && (
        <Content
          insights={filteredInsights}
          selectedIndex={selectedIndex}
          expandedInsight={currentInsight}
          searchQuery={!isExpanded ? inputValue : ''}
          showFavoritesOnly={showFavoritesOnly}
        />
      )}
    </Box>
  );
}
