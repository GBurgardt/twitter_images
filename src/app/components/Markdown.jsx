/**
 * Markdown.jsx - Componente para renderizar Markdown en Ink
 *
 * Reimplementación compatible con ESM de ink-markdown.
 * Usa marked + marked-terminal para parsear y formatear.
 */

import React from 'react';
import { Text } from 'ink';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// Configurar marked con la extensión terminal
// markedTerminal() retorna una extensión compatible con marked.use()
marked.use(
  markedTerminal({
    reflowText: true,
    width: 76,
    // Estilos default de marked-terminal son buenos:
    // strong: chalk.bold
    // em: chalk.italic
    // heading: chalk.green.bold
    // firstHeading: chalk.magenta.underline.bold
    // code: chalk.yellow
    // codespan: chalk.yellow
    // link: chalk.blue
    // blockquote: chalk.gray.italic
  })
);

/**
 * Componente Markdown - renderiza texto markdown en la terminal
 *
 * @param {string} children - El texto markdown a renderizar
 * @param {object} props - Opciones adicionales pasadas a marked-terminal
 */
export default function Markdown({ children, ...options }) {
  if (!children || typeof children !== 'string') {
    return null;
  }

  try {
    // Parsear el markdown a texto con códigos ANSI
    const parsed = marked.parse(children).trim();

    // Ink's <Text> renderiza los códigos ANSI correctamente
    return <Text>{parsed}</Text>;
  } catch (err) {
    // Si falla el parsing, mostrar texto plano
    console.error('[Markdown] Error parsing:', err.message);
    return <Text>{children}</Text>;
  }
}
