# Twitter / X Media Insight CLI

Turn any tweet (images, videos, text) or YouTube clip into usable text and an action plan in one shot. The tool auto-detects the media type, runs OCR or Whisper, and optionally feeds the result through a post-processor that speaks in your favorite tone (Musk by default, Bukowski, raw transcript, etc.).

## Requirements

1. Node.js 18+
2. Google Gemini API key (`.env` with `GEMINI_API_KEY=...`) para el agente/OCR
3. OpenAI API key (`.env` con `OPENAI_API_KEY=...`) para transcribir audio/video con Whisper
4. [gallery-dl](https://github.com/mikf/gallery-dl) on your `PATH` (tweet/thread downloads)
5. [yt-dlp](https://github.com/yt-dlp/yt-dlp) + [ffmpeg](https://ffmpeg.org/) on your `PATH` (YouTube audio extraction)

Install JS deps and set up your key:

```bash
npm install
echo "GEMINI_API_KEY=..." >> .env
echo "OPENAI_API_KEY=..." >> .env
```

## Quick start: the `twx` command

Link/install the CLI globally so `twx` is available everywhere:

```bash
npm link   # or: npm install -g .
```

Usage:

```bash
twx <url-or-path> [style] [extra options]
```

Examples:

- `twx https://x.com/user/status/12345` → downloads the tweet, extracts all text, and returns a Musk-style plan + summary.
- `twx https://youtu.be/clip buk` → pulls the YouTube audio via `yt-dlp`, transcribes with Whisper, and replies like Bukowski.
- `twx ./gallery-dl/twitter/thread raw` → reuse an existing folder and just dump the raw transcript.
- `twx https://x.com/... tell "explain how to pitch this in 30s"` → Musk tone + instrucción inline sin recordar `--style-text`.

`style` is optional and defaults to `musk`. Aliases you can use as the second word:

| Style | Aliases            | What it does |
|-------|--------------------|--------------|
| `musk` (default) | `m`, `mx`, `max`, `elon` | Direct, technical, action-first |
| `bukowski` | `buk`, `bk` | Gritty, blunt recap |
| `brief` | `brief`, `sum` | Three sharp executive bullets |
| `raw` | `raw`, `plain`, `txt` | Skips GPT entirely; prints only the raw OCR/transcription |
| `tell` | `tell` | Musk voice + quoted inline instruction |

Need a custom voice? Either use the `tell` shorthand or create a text file with your instruction (e.g., `brief.txt`) and run:

```bash
twx https://x.com/... musk --style-file brief.txt
```

Todos los planes y respuestas salen en español (tono directo) para que puedas copiar y pegar sin traducir. La reflexión interna completa se guarda en `current_session.txt`; agregá `--show-reflection` si querés verla en pantalla al instante.

### Chat inline

Después del primer resumen Musk, el CLI queda abierto como chat: escribí en `ask elon ›` con saltos de línea usando Enter; enviá con `/send` y salí con `/q` o `:q`. Cada turno mantiene el historial (XML) para que la voz conserve contexto.

### Feedback visual

El CLI usa spinners de [ora](https://github.com/sindresorhus/ora) para mostrar el progreso mientras descarga, procesa medios o genera el plan con `gemini-3-pro-preview`. Si preferís salida “silenciosa”, exportá `TWX_NO_SPINNER=1` antes de correr `twx`.

### Reflexión interactiva

Al terminar, si hay reflexión interna oculta verás el mensaje `Presioná [r] para leerla ahora`. Ese atajo limpia la pantalla, muestra la reflexión completa y te deja volver al resumen con `[b]`. Si no querés interactuar, simplemente tocá Enter y quedará guardada en `current_session.txt`.

### Resultado final

El único bloque mostrado por defecto es un resumen de 3‑7 párrafos (3‑5 líneas cada uno) en voz Musk, explicando con claridad la idea central del video/imágenes, como si te lo contara en persona. Todo lo demás (interpretación intermedia, texto del tweet/caption, reflexión interna) queda detrás del modal interactivo o en el log.

### Depuración total

Si necesitás ver absolutamente todo (payloads enviados, respuesta XML, rutas internas), agrega `--debug` al comando o exportá `TWX_DEBUG=1`. En ese modo se imprime cada paso del pipeline y la respuesta cruda del SDK para inspeccionar formatos.

## Advanced CLI (`npm run ocr`)

You still have access to the detailed flags:

```bash
npm run ocr -- --url https://x.com/... --style buk --output result.json
```

Options:

- `--path ./folder` — use local media (images, videos, text snippets)
- `--url https://x.com/...` — fetch via `gallery-dl`
- `--url https://youtu.be/...` — fetch via `yt-dlp`
- `--prompt "..."` — custom OCR instructions for images
- `--style <preset>` / `--style-file file.txt` / `--style-text "inline"` — control the post-processor
- `--mode long` / `--long` — usa el prompt largo (12–20 párrafos, más cobertura). Default: estándar.
- `--mode top` / `--top` — usa el prompt de TOP 5 (cinco hallazgos explicados en detalle). Default: estándar.
- `--json`, `--output file.json` — machine-readable output of every file
- `--session-log custom.txt` — redirect the XML reflections
- `--agent-prompt prompts/agent_prompt.txt` — swap the high-level prompt template

Behind the scenes:

1. Files are downloaded to `gallery-dl-runs/run-*` (or `yt-*` for YouTube).
2. Images pasan por Gemini 3 (`GEMINI_VISION_MODEL`, default `gemini-3-pro-preview`) con media resolution alta para sacar texto fino.
3. Videos y audio se comprimen si pesan >25 MB y se transcriben con Whisper (`OPENAI_TRANSCRIBE_MODEL`, default `whisper-1`), usando tu `OPENAI_API_KEY`.
4. Text files (e.g., tweet captions saved by `gallery-dl`) are read directly.
5. Results feed into the post-processor defined en `prompts/agent_prompt.txt` (modo estándar), `prompts/agent_prompt_long.txt` (modo largo) o `prompts/agent_prompt_top.txt` (modo top 5), corrido con `gemini-3-pro-preview` con `thinking_level=high`, ventana 1 M/64 k tokens y salida en español:
   - `<internal_reflection>` long-form reasoning (visible sólo si lo pedís)
   - `<action_plan>` la interpretación pragmática (oculta por defecto)
   - `<final_response>` 3‑7 párrafos en voz Musk (modo estándar), 12‑20 párrafos (modo largo), o 5 bloques numerados explicando los hallazgos top (modo top)
6. El prompt recibe, junto a cada medio, el texto del tweet/caption y descripciones de YouTube para que el resumen entienda el contexto original.

## Tips

- Set `TWX_DEFAULT_STYLE` in your shell to change the default preset for both `twx` and `npm run ocr`.
- Use `--style raw` when you only want transcripts/OCR without any summarization.
- Store frequently used briefs in `prompts/*.txt` and reference them with `--style-file`.
- `current_session.txt` accumulates every XML response; clear it when you need a fresh log.
- No borres los `.json` que generan gallery-dl / yt-dlp; contienen el texto original del tweet/caption y se usan como contexto.
- Si necesitás limitar el tamaño de salida del agente, ajustá `GEMINI_AGENT_MAX_OUTPUT_TOKENS` (default 64 000).
- El CLI comprime y, si es necesario, parte en segmentos de ~8 min cualquier audio/video >25 MB antes de Whisper; ajustá `WHISPER_SEGMENT_SECONDS`, `WHISPER_AUDIO_BITRATE`, `WHISPER_SAMPLE_RATE` si necesitás mayor granularidad. Asegurate de tener ffmpeg instalado.
- Exportá `TWX_MODE=long` si querés que el prompt largo sea el predeterminado sin pasar flags.

The entire experience is optimized for a two-word command: paste the URL, add a short preset tag, and let the tool do the rest. The raw text, transcriptions, contexto, interpretación y respuesta final quedan listas en una sola corrida.
