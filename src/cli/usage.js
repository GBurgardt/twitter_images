export function showUsage() {
  console.log(`
  twx

  Paste a URL. Get the insight. Chat with your ideas.

  USAGE
    twx                         Open library (browse & chat with saved ideas)
    twx <url>                   Analyze: Twitter, YouTube, any URL
    twx <url> "<directive>"     Add optional directive for the model
    twx <url> --thread          Extract full Twitter thread via API
    twx <url> transcript        Get raw transcript (yt-dlp + Whisper)
    twx <path>                  Analyze local files
    twx list                    Show history
    twx config                  Setup API keys
    twx setmodel gpt-5.2        Switch AI provider (gpt-5.2|gpt-5.2-pro|gemini|opus)
    twx <url> --model gemini     One-off override (gemini|gpt-5.2|gpt-5.2-pro|opus)

  LIBRARY (twx without arguments)
    ↑↓        Navigate (max 10 shown, favorites first)
    Enter     Open idea & chat
    🔍        Search option appears if you have 10+ ideas
    Ctrl+C    Exit

  CHAT WITH AN IDEA
    1. Run: twx
    2. Select idea (★ favorites at top)
    3. View insight + previous conversations
    4. Type question, Enter to send (empty = return to list)
    5. AI responds with full context
    6. Saved automatically. Return to list when done.

    (3) = 3 messages in conversation
    ★ = favorite

  TRANSCRIPT
    twx <youtube-url> transcript                    Download + Whisper transcription
    twx <youtube-url> transcript --clip 0:30-2:00   Only a segment

  STYLES
    twx <url> bukowski          Charles Bukowski voice (default)
    twx <url> musk              Elon Musk voice (alias: elon, m, mx)

  OPTIONS
    --clip 0:30-2:00            Video segment
    --thread                    Extract full Twitter thread
    --model <id>                One-off model/provider override
    --verbose                   Show technical details

  EXAMPLES
    twx                                             # Open library, chat with ideas
    twx https://x.com/user/status/123456            # Analyze tweet
    twx https://x.com/user/status/123456 --thread   # Analyze full thread
    twx https://youtube.com/watch?v=abc             # Analyze YouTube video
    twx https://youtube.com/watch?v=abc transcript  # Just transcribe
    twx https://youtube.com/watch?v=abc --clip 1:00-5:00
    twx ./screenshots/ bukowski
`);
}

