
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

## Dual mode

```bash
twx dual <url> --styles bukowski,elon
```

Dos columnas. Dos estilos. Dos chats independientes.
Tab cambia foco. Enter envía al panel activo. Ctrl+B envía a ambos.

---

## Estilos

```bash
twx <url> bukowski     # Crudo, sin filtro (default)
twx <url> musk         # Directo, técnico
twx <url> nunc         # Explica simple, literal (Sin Vueltas)
twx <url> nunca        # Alias memorable
twx <url> easy         # Alias corto
twx <url> transcript   # Solo transcripción
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

## Modelos

```bash
twx setmodel             # Elegir modelo (interactive)
twx setmodel opus        # Claude Opus 4.5
twx setmodel gemini      # Gemini 3 Pro
twx setmodel gpt-5.2     # OpenAI GPT-5.2
twx <url> --model opus   # Override por corrida
```

---

## Qué necesita

| Key | Para qué | Requerida |
|-----|----------|-----------|
| Mistral | Leer imágenes (OCR) | Sí |
| Gemini | Análisis con IA | Recomendada |
| Anthropic (Claude) | Análisis con IA (Claude Opus 4.5) | Opcional |
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
