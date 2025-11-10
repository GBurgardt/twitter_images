# Twitter / X Media Insight CLI

Turn any tweet (images, videos, text) or YouTube clip into usable text and an action plan in one shot. The tool auto-detects the media type, runs OCR or Whisper, and optionally feeds the result through a post-processor that speaks in your favorite tone (Musk by default, Bukowski, raw transcript, etc.).

## Requirements

1. Node.js 18+
2. OpenAI API key (`.env` with `OPENAI_API_KEY=sk-...`)
3. [gallery-dl](https://github.com/mikf/gallery-dl) on your `PATH` (tweet/thread downloads)
4. [yt-dlp](https://github.com/yt-dlp/yt-dlp) + [ffmpeg](https://ffmpeg.org/) on your `PATH` (YouTube audio extraction)

Install JS deps and set up your key:

```bash
npm install
echo "OPENAI_API_KEY=sk-..." >> .env
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

`style` is optional and defaults to `musk`. Aliases you can use as the second word:

| Style | Aliases            | What it does |
|-------|--------------------|--------------|
| `musk` (default) | `m`, `mx`, `max`, `elon` | Direct, technical, action-first |
| `bukowski` | `buk`, `bk` | Gritty, blunt recap |
| `brief` | `brief`, `sum` | Three sharp executive bullets |
| `raw` | `raw`, `plain`, `txt` | Skips GPT entirely; prints only the raw OCR/transcription |

Need a custom voice? Create a text file with your instruction (e.g., `brief.txt`) and run:

```bash
twx https://x.com/... musk --style-file brief.txt
```

Todos los planes y respuestas salen en español (tono directo) para que puedas copiar y pegar sin traducir. La reflexión interna completa se guarda en `current_session.txt`; agregá `--show-reflection` si querés verla en pantalla al instante.

### Feedback visual

El CLI usa spinners de [ora](https://github.com/sindresorhus/ora) para mostrar el progreso mientras descarga, procesa medios o genera el plan con `gpt-5-codex`. Si preferís salida “silenciosa”, exportá `TWX_NO_SPINNER=1` antes de correr `twx`.

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
- `--json`, `--output file.json` — machine-readable output of every file
- `--session-log custom.txt` — redirect the XML reflections
- `--agent-prompt prompts/agent_prompt.txt` — swap the high-level prompt template

Behind the scenes:

1. Files are downloaded to `gallery-dl-runs/run-*` (or `yt-*` for YouTube).
2. Images go through the multimodal model (`OPENAI_OCR_MODEL`, default `gpt-4.1-mini`).
3. Videos and audio go through Whisper (`OPENAI_TRANSCRIBE_MODEL`, default `whisper-1`).
4. Text files (e.g., tweet captions saved by `gallery-dl`) are read directly.
5. Results feed into the post-processor defined in `prompts/agent_prompt.txt`, powered by `gpt-5-codex` with high reasoning effort, which always outputs:
   - `<internal_reflection>` long-form reasoning (hidden unless requested)
   - `<action_plan>` prioritized steps
   - `<final_response>` the short answer in the requested tone

## Tips

- Set `TWX_DEFAULT_STYLE` in your shell to change the default preset for both `twx` and `npm run ocr`.
- Use `--style raw` when you only want transcripts/OCR without any summarization.
- Store frequently used briefs in `prompts/*.txt` and reference them with `--style-file`.
- `current_session.txt` accumulates every XML response; clear it when you need a fresh log.

The entire experience is optimized for a two-word command: paste the URL, add a short preset tag, and let the tool do the rest. The raw text, transcriptions, plan, and final response are all ready in one run.
