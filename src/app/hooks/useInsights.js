/**
 * useInsights.js - CRUD de insights desde MongoDB
 */

import { useState, useEffect, useCallback } from 'react';
import { listRuns, getRunById, toggleFavorite as dbToggleFavorite, listFavorites } from '../../db.js';
import mongoose from 'mongoose';

export function useInsights() {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Cargar insights
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const runs = showFavoritesOnly
        ? await listFavorites({ limit: 50 })
        : await listRuns({ limit: 50 });
      setInsights(runs);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [showFavoritesOnly]);

  // Toggle filtro de favoritos
  const toggleFavoritesFilter = useCallback(() => {
    setShowFavoritesOnly(prev => !prev);
  }, []);

  // Cargar al montar
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Agregar conversación a un insight
  const addConversation = useCallback(async (insightId, question) => {
    try {
      const insight = await getRunById(insightId);
      if (!insight) return;

      // Importar el analizador para hacer la pregunta
      const { askFollowUp } = await import('../analyze.js');
      const answer = await askFollowUp(insight, question);

      // Guardar la conversación
      const conversations = insight.conversations || [];
      conversations.push({
        question,
        answer,
        timestamp: new Date()
      });

      // Actualizar en MongoDB
      const Run = mongoose.models.Run || mongoose.model('Run', new mongoose.Schema({}, { strict: false }));
      await Run.findByIdAndUpdate(insightId, {
        $set: { conversations }
      });

      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [refresh]);

  // Borrar insight
  const deleteInsight = useCallback(async (insightId) => {
    try {
      const Run = mongoose.models.Run || mongoose.model('Run', new mongoose.Schema({}, { strict: false }));
      await Run.findByIdAndDelete(insightId);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }, [refresh]);

  // Toggle favorito de un insight
  const toggleFavorite = useCallback(async (insightId, note = null) => {
    try {
      const result = await dbToggleFavorite(insightId, note);
      if (result) {
        await refresh();
        return result.isFavorite;
      }
      return null;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [refresh]);

  return {
    insights,
    loading,
    error,
    refresh,
    addConversation,
    deleteInsight,
    toggleFavorite,
    showFavoritesOnly,
    toggleFavoritesFilter
  };
}
