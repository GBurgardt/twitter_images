# Twitter OCR Pipeline

CLI helper to turn media downloaded with `gallery-dl` into plain text using OpenAI's multimodal model `gpt-4.5-nano`.

## Setup

1. Install dependencies
   ```bash
   npm install
   ```
2. Create a `.env` file alongside `package.json` with your key:
   ```bash
   echo "OPENAI_API_KEY=sk-..." >> .env
   ```
   Optional overrides:
   - `OPENAI_OCR_MODEL` to swap the modelo multimodal (por defecto `gpt-4.1-mini`, que acepta imágenes)
   - `OPENAI_OCR_PROMPT` to customise the extraction instructions
   - `OPENAI_OCR_MAX_OUTPUT_TOKENS` to cap response length
   - `OPENAI_OCR_DOWNLOAD_ROOT` to choose where temporary tweet downloads live (defaults to `./gallery-dl-runs`)

Ensure [`gallery-dl`](https://github.com/mikf/gallery-dl) is installed and on your `PATH` if you want the tool to fetch tweets automatically.

## Usage

Run the extractor against an image file or a directory produced by `gallery-dl`:

```bash
npm run ocr -- --path ./gallery-dl/twitter/FlamebearerEno
```

Or let it download the tweet for you (images only):

```bash
npm run ocr -- --url https://x.com/FlamebearerEno/status/1981520427215442067
```

Useful flags:
- `--output ocr.json` saves the structured result to disk
- `--json` prints the same JSON to stdout
- `--no-recursive` disables subdirectory scanning
- `--prompt "Extract text and translate to English"` overrides the prompt per run

Each image is sent individually to OpenAI Vision, encoded as `data:` URLs, and the model returns raw text with spacing preserved.

Downloads triggered via `--url` land in `./gallery-dl-runs/run-*/` so you can re-check the media later. The script ignores non-image files and reports an error if nothing suitable is found.

> The script currently targets image files. If `gallery-dl` only produced videos for a tweet, you will need to extract still frames separately before running OCR.
