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
 * Format relative date
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
}

/**
 * Header - always visible, orients the user
 */
function Header({ title, count, showFavoritesOnly, isFavorite }) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={2} marginBottom={1}>
      <Box flexGrow={1}>
        <Text bold color="cyan">twx</Text>
        <Text dimColor> · </Text>
        {showFavoritesOnly && <Text color="#FFD700">★ </Text>}
        {isFavorite && <Text color="#FFD700">★ </Text>}
        {title && <Text>{title}</Text>}
      </Box>
      {count !== undefined && (
        <Text dimColor>{count} items</Text>
      )}
    </Box>
  );
}

/**
 * Footer - shortcuts always visible
 */
function Footer({ mode, showFavoritesOnly }) {
  const shortcuts = mode === 'list'
    ? [
        { key: '↑↓', label: 'navigate' },
        { key: 'Enter', label: 'open' },
        { key: 'F', label: showFavoritesOnly ? 'show all' : '★ favorites' },
        { key: '/', label: 'search' },
        { key: 'q', label: 'quit' },
      ]
    : [
        { key: '↑↓', label: 'scroll' },
        { key: 'F', label: '★ favorite' },
        { key: 'Esc', label: 'back' },
        { key: 'd', label: 'delete' },
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
 * Insight list - with visible selector from the start
 */
function InsightList({ insights, selectedIndex, showFavoritesOnly }) {
  if (!insights.length) {
    return (
      <Box flexDirection="column" paddingY={2} paddingX={2}>
        {showFavoritesOnly ? (
          <>
            <Text dimColor>No favorites saved.</Text>
            <Text dimColor>Press F to show all insights.</Text>
          </>
        ) : (
          <>
            <Text dimColor>No saved insights.</Text>
            <Text dimColor>Copy a URL and run: twx {'<url>'}</Text>
          </>
        )}
      </Box>
    );
  }

  // Show max 20 items to avoid clutter
  const visibleInsights = insights.slice(0, 20);

  return (
    <Box flexDirection="column" paddingY={1}>
      {visibleInsights.map((insight, index) => {
        const isSelected = index === selectedIndex;
        const isFavorite = insight.isFavorite;
        const title = insight.title || 'Untitled';
        // Use updatedAt for last activity, fallback to createdAt
        const date = formatDate(insight.updatedAt || insight.createdAt);
        // Count conversations
        const msgCount = (insight.conversations || []).length;

        return (
          <Box key={insight._id.toString()}>
            {/* Selection indicator - ALWAYS visible */}
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? ' ▶ ' : '   '}
            </Text>
            {/* Favorite star */}
            <Text color="#FFD700">
              {isFavorite ? '★ ' : '  '}
            </Text>
            {/* Title with highlight if selected */}
            <Text
              backgroundColor={isSelected ? 'blue' : undefined}
              color={isSelected ? 'white' : undefined}
              bold={isSelected}
            >
              {title.slice(0, 45)}{title.length > 45 ? '...' : ''}
            </Text>
            {/* Conversation count */}
            {msgCount > 0 && (
              <Text dimColor> ({msgCount})</Text>
            )}
            {/* Date on the right */}
            {!isSelected && date && (
              <Text dimColor> · {date}</Text>
            )}
          </Box>
        );
      })}
      {insights.length > 20 && (
        <Box paddingX={3} marginTop={1}>
          <Text dimColor>... and {insights.length - 20} more</Text>
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

  const title = insight.title || 'Untitled';
  const content = insight.finalResponse || '';
  const conversations = insight.conversations || [];

  return (
    <Box flexDirection="column" paddingY={1} paddingX={1}>
      {/* Main content in box */}
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
            <Text dimColor italic>You: {conv.question}</Text>
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
 * WITH header and footer to orient the user
 */
export default function Content({
  insights,
  selectedIndex,
  expandedInsight,
  searchMode,
  searchQuery,
  showFavoritesOnly
}) {
  // If there's an expanded insight, show it
  if (expandedInsight) {
    const title = expandedInsight.title || 'Insight';
    const isFavorite = expandedInsight.isFavorite;
    return (
      <Box flexDirection="column">
        <Header title={title} isFavorite={isFavorite} />
        <InsightView insight={expandedInsight} />
        <Footer mode="insight" />
      </Box>
    );
  }

  // Determine header title
  let headerTitle = 'Library';
  if (showFavoritesOnly) {
    headerTitle = 'Favorites';
  } else if (searchMode) {
    headerTitle = `Searching: ${searchQuery}`;
  }

  // Show list
  return (
    <Box flexDirection="column">
      <Header
        title={headerTitle}
        count={insights.length}
        showFavoritesOnly={showFavoritesOnly}
      />
      <InsightList
        insights={insights}
        selectedIndex={selectedIndex}
        showFavoritesOnly={showFavoritesOnly}
      />
      <Footer mode="list" showFavoritesOnly={showFavoritesOnly} />
    </Box>
  );
}
