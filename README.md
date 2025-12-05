# twx

Pegá una URL. Obtené el insight.

```
twx https://x.com/elonmusk/status/123456
```

Eso es todo.

---

## Instalación

```bash
npm install -g .
twx config
```

La primera vez te pide las API keys. Una vez. Nunca más.

---

## Uso

```bash
# Twitter/X
twx https://x.com/user/status/123456

# YouTube
twx https://youtube.com/watch?v=abc123

# Archivos locales
twx ./screenshots/
twx ./video.mp4
```

---

## Estilos

```bash
twx <url> musk      # Directo, técnico (default)
twx <url> bukowski  # Crudo, sin filtro
twx <url> brief     # 3 bullets
twx <url> raw       # Solo transcripción
```

---

## Clips de video

```bash
twx <url> --clip 0:30-2:00
```

Solo transcribe ese fragmento.

---

## Historial

```bash
twx list            # Ver análisis anteriores
twx <id>            # Abrir uno específico
```

---

## Configuración

```bash
twx config          # Setup inicial
twx config --reset  # Empezar de cero
```

---

## Qué necesita

| Key | Para qué | Requerida |
|-----|----------|-----------|
| Mistral | Leer imágenes (OCR) | Sí |
| Gemini | Análisis con IA | Recomendada |
| OpenAI | Transcribir audio | Opcional |

---

## Dependencias externas

```bash
brew install ffmpeg      # Audio/video
pip install gallery-dl   # Twitter
pip install yt-dlp       # YouTube
```

---

## Debug

```bash
twx <url> --verbose
```

---

Simple. Rápido. Sin ruido.
