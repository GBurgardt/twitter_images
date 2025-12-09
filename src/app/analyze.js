/**
 * analyze.js - Módulo de análisis para la UI interactiva
 *
 * Ejecuta el script existente y obtiene el resultado de MongoDB.
 * Sin duplicación de código. Limpio.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { listRuns } from '../db.js';
import { loadConfig } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const EXTRACT_SCRIPT = path.join(PROJECT_ROOT, 'src/extract-text.js');

/**
 * Analiza una URL ejecutando el script existente
 * Devuelve el insight guardado en MongoDB
 */
export async function analyzeUrl(url) {
  return new Promise((resolve, reject) => {
    // Ejecutar el script existente silenciosamente
    const child = spawn(process.execPath, [EXTRACT_SCRIPT, url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    let stderr = '';
    child.stderr?.on('data', chunk => stderr += chunk.toString());

    child.on('error', (err) => {
      reject(new Error(`Error ejecutando análisis: ${err.message}`));
    });

    child.on('exit', async (code) => {
      if (code !== 0) {
        // Extraer mensaje de error legible
        const errorMatch = stderr.match(/Error[:\s]+(.+)/i) ||
                          stderr.match(/Could not (.+)/i) ||
                          stderr.match(/No (.+)/i);
        const errorMsg = errorMatch ? errorMatch[0] : 'Error al analizar la URL';
        reject(new Error(errorMsg));
        return;
      }

      try {
        // El script guardó en MongoDB, obtener el último insight
        const insights = await listRuns({ limit: 1 });
        if (insights.length > 0) {
          resolve(insights[0]);
        } else {
          reject(new Error('No se guardó el análisis'));
        }
      } catch (err) {
        reject(new Error(`Error obteniendo resultado: ${err.message}`));
      }
    });
  });
}

/**
 * Hace una pregunta de seguimiento sobre un insight existente
 */
export async function askFollowUp(insight, question) {
  const config = await loadConfig();

  const providerRaw = (config.agentProvider || 'gemini').toLowerCase();
  const agentProvider = providerRaw === 'claude' ? 'claude' : 'gemini';

  const geminiClient = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;
  const anthropicClient = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

  // Construir contexto
  const context = `
Contenido original del análisis:
${insight.finalResponse || ''}

Conversaciones previas:
${(insight.conversations || []).map(c => `Usuario: ${c.question}\nRespuesta: ${c.answer}`).join('\n\n')}
`;

  const prompt = `
${context}

Nueva pregunta del usuario:
${question}

Responde de manera concisa y directa en español.
`;

  if (agentProvider === 'claude' && anthropicClient) {
    const response = await anthropicClient.messages.create({
      model: config.agentModel || 'claude-opus-4-5-20251101',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      temperature: 1
    });

    return response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  } else if (geminiClient) {
    const response = await geminiClient.models.generateContent({
      model: config.agentModel || 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    return response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  throw new Error('No hay cliente de IA disponible');
}
