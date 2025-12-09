/**
 * useAnalyze.js - Hook para analizar URLs
 */

import { useState, useCallback } from 'react';

export function useAnalyze() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const analyze = useCallback(async (url) => {
    try {
      setLoading(true);
      setError(null);

      // Importar el analizador
      const { analyzeUrl } = await import('../analyze.js');
      const result = await analyzeUrl(url);

      setLoading(false);
      return result;
    } catch (err) {
      setLoading(false);
      setError(err.message || 'Error al analizar');
      return null;
    }
  }, []);

  return {
    analyze,
    loading,
    error
  };
}
