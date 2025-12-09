/**
 * App.jsx - El corazón de twx
 *
 * La interfaz ha desaparecido. Solo queda:
 * - Contenido (lista o insight)
 * - Input (cursor)
 * - Hints efímeros
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
  const { insights, loading: insightsLoading, refresh, addConversation, deleteInsight } = useInsights();
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
        setHint({ type: 'help', text: '? para ayuda' });
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
          setHint({ type: 'copied', text: 'Copiado' });
          setTimeout(() => setHint(h => h?.type === 'copied' ? null : h), 1500);
        });
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
    <Box flexDirection="column" height="100%">
      {/* Hint - efímero, arriba */}
      {hint && !showHelp && (
        <Box marginBottom={1}>
          <Text dimColor>
            {hint.type === 'url' && `[Enter] ${hint.text}`}
            {hint.type === 'help' && hint.text}
            {hint.type === 'copied' && hint.text}
          </Text>
        </Box>
      )}

      {/* Help overlay */}
      {showHelp && <Help />}

      {/* Loading state */}
      {(analyzing || insightsLoading) && !showHelp && (
        <Box justifyContent="center" marginY={2}>
          <Text>
            <Spinner type="dots" />
          </Text>
        </Box>
      )}

      {/* Error state */}
      {analyzeError && !analyzing && !showHelp && (
        <Box flexDirection="column" marginY={2}>
          <Text color="red">{analyzeError}</Text>
          <Text dimColor>[r] reintentar</Text>
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
        />
      )}

      {/* Input - siempre visible */}
      {!showHelp && (
        <Input
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleInputSubmit}
          placeholder={searchMode ? '/' : ''}
          disabled={analyzing}
        />
      )}
    </Box>
  );
}
