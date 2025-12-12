/**
 * Agent payload builder (shared by analysis + chat).
 *
 * Keep this pure: no IO, no UI, no provider-specific code.
 */

export function buildAgentPayload({ results, styleKey, preset = '', customStyle = '', directive = '' }) {
  const blocks = [];

  blocks.push('Idioma obligatorio: español neutro, tono directo y pragmático.');
  blocks.push('IMPORTANTE: Devuelve el XML con TODOS los tags requeridos: <response><title>...</title><internal_reflection>...</internal_reflection><action_plan>...</action_plan><final_response>...</final_response></response>');
  blocks.push('CRÍTICO: Cierra TODOS los tags XML. En particular, SIEMPRE cierra <final_response> con </final_response> y termina con </response>. No puede haber texto después de </response>.');
  blocks.push('FORMATO (obligatorio): En <final_response> escribe SOLO texto plano (sin Markdown). Usa párrafos cortos, saltos de línea, y si hace falta listas usa "•" o numeración "1)". Para URLs escribe "URL: https://..." en línea.');
  blocks.push(`Style preset: ${styleKey || 'none'}`);

  if (directive?.trim()) {
    blocks.push(`Instrucción del usuario (obligatoria, prioritaria):\n${directive.trim()}`);
  }

  if (preset) blocks.push(`Preset instructions:\n${preset}`);
  if (customStyle?.trim()) blocks.push(`User custom instructions:\n${customStyle.trim()}`);

  blocks.push(
    'Materiales analizados:\n' +
    (results || []).map((entry, i) => {
      const base = [`Item ${i + 1}`, `Archivo: ${entry.file}`, `Tipo: ${entry.type}`];
      if (entry.error) {
        base.push(`Error: ${entry.error}`);
      } else {
        base.push(`Texto:\n${entry.text || '[Sin texto]'}`);
      }
      if (entry.context) {
        base.push(`Contexto:\n${entry.context}`);
      }
      return base.join('\n');
    }).join('\n\n')
  );

  return blocks.join('\n\n');
}

