/**
 * App.jsx - The heart of twx
 *
 * The interface has disappeared. Only remains:
 * - Content (list or insight)
 * - Input (cursor)
 * - Ephemeral hints
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';

import { useInsights } from './hooks/useInsights.js';
import { useAnalyze } from './hooks/useAnalyze.js';
import { useClipboard } from './hooks/useClipboard.js';
import Content from './components/Content.jsx';
import Input from './components/Input.jsx';
import Help from './components/Help.jsx';

export default function App() {
  const { exit } = useApp();

  // Core state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [searchMode, setSearchMode] = useState(false);
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
  const filteredInsights = searchMode && inputValue
    ? insights.filter(i =>
        i.title?.toLowerCase().includes(inputValue.toLowerCase()) ||
        i.finalResponse?.toLowerCase().includes(inputValue.toLowerCase())
      )
    : insights;

  // Check clipboard on mount
  useEffect(() => {
    checkClipboard();
  }, []);

  // Show URL hint if clipboard has URL
  useEffect(() => {
    if (clipboardUrl && !isExpanded && !analyzing) {
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
  }, [clipboardUrl, isExpanded, analyzing]);

  // Show first-run help hint
  useEffect(() => {
    if (firstRun && insights.length > 0) {
      setTimeout(() => {
        setHint({ type: 'help', text: '? for help' });
        setTimeout(() => {
          setHint(h => h?.type === 'help' ? null : h);
          setFirstRun(false);
        }, 3000);
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
      const msg = isFav ? '★ Favorite' : '☆ Removed from favorites';
      setHint({ type: 'favorite', text: msg });
      setTimeout(() => setHint(h => h?.type === 'favorite' ? null : h), 1500);
    }
  }, [currentInsight, toggleFavorite]);

  // Keyboard handling
  useInput((input, key) => {
    // Help toggle
    if (input === '?' && !searchMode) {
      setShowHelp(h => !h);
      return;
    }

    // Close help on any key
    if (showHelp) {
      setShowHelp(false);
      return;
    }

    // Quit
    if (input === 'q' && !searchMode && !inputValue) {
      exit();
      return;
    }

    // Escape - back / cancel
    if (key.escape) {
      if (searchMode) {
        setSearchMode(false);
        setInputValue('');
      } else if (isExpanded) {
        setExpandedId(null);
        setInputValue('');
      }
      setHint(null);
      return;
    }

    // When hint is showing and not expanded
    if (hint?.type === 'url' && !isExpanded && !analyzing) {
      if (key.return) {
        handleAnalyze(hint.url);
        return;
      }
      // Any other key dismisses hint
      if (input && input !== '?' && input !== 'q') {
        setHint(null);
      }
    }

    // Search mode toggle
    if (input === '/' && !isExpanded && !inputValue) {
      setSearchMode(true);
      return;
    }

    // Navigation in list
    if (!isExpanded && !searchMode && !inputValue) {
      if (key.upArrow) {
        setSelectedIndex(i => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(i => Math.min(filteredInsights.length - 1, i + 1));
        return;
      }
      if (key.return && filteredInsights.length > 0) {
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
          setHint({ type: 'copied', text: 'Copied' });
          setTimeout(() => setHint(h => h?.type === 'copied' ? null : h), 1500);
        });
      }
      return;
    }

    // Toggle favorite (F key)
    if ((input === 'f' || input === 'F') && !searchMode && !inputValue) {
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
    if (searchMode) {
      // Exit search mode on enter
      setSearchMode(false);
      if (filteredInsights.length > 0) {
        const insight = filteredInsights[0];
        setExpandedId(insight._id.toString());
        setInputValue('');
      }
    } else if (isExpanded && value.trim()) {
      handleSendQuestion(value);
    }
  }, [searchMode, isExpanded, filteredInsights, handleSendQuestion]);

  // Render
  return (
    <Box flexDirection="column">
      {/* Help overlay */}
      {showHelp && <Help />}

      {/* Loading state */}
      {(analyzing || insightsLoading) && !showHelp && (
        <Box flexDirection="column" paddingY={2}>
          <Box borderStyle="single" borderColor="gray" paddingX={2}>
            <Text bold color="cyan">twx</Text>
            <Text dimColor> · Loading...</Text>
          </Box>
          <Box justifyContent="center" marginY={2}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> {analyzing ? 'Analyzing...' : 'Loading library...'}</Text>
          </Box>
        </Box>
      )}

      {/* Error state */}
      {analyzeError && !analyzing && !showHelp && (
        <Box flexDirection="column" marginY={2} paddingX={2}>
          <Text color="red">{analyzeError}</Text>
          <Text dimColor>[r] retry  [Esc] back</Text>
        </Box>
      )}

      {/* URL hint - when there's a URL in clipboard */}
      {hint?.type === 'url' && !isExpanded && !analyzing && !showHelp && (
        <Box marginBottom={1} paddingX={2}>
          <Text color="green">[Enter]</Text>
          <Text> Analyze: </Text>
          <Text dimColor>{hint.text}</Text>
        </Box>
      )}

      {/* Copied feedback */}
      {hint?.type === 'copied' && (
        <Box paddingX={2}>
          <Text color="green">✓ {hint.text}</Text>
        </Box>
      )}

      {/* Favorite feedback */}
      {hint?.type === 'favorite' && (
        <Box paddingX={2}>
          <Text color="yellow">{hint.text}</Text>
        </Box>
      )}

      {/* Main content */}
      {!analyzing && !insightsLoading && !showHelp && (
        <Content
          insights={filteredInsights}
          selectedIndex={selectedIndex}
          expandedInsight={currentInsight}
          searchMode={searchMode}
          searchQuery={searchMode ? inputValue : ''}
          showFavoritesOnly={showFavoritesOnly}
        />
      )}

      {/* Input - solo cuando está expandido o en búsqueda */}
      {!showHelp && (isExpanded || searchMode) && (
        <Box paddingX={2} marginTop={1}>
          <Text dimColor>{searchMode ? '/' : '›'} </Text>
          <Input
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleInputSubmit}
            placeholder=""
            disabled={analyzing}
          />
        </Box>
      )}
    </Box>
  );
}
