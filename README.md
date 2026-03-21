# WhatsApp AI Bot

A self-hosted WhatsApp AI assistant powered by [Ollama](https://ollama.com) (local LLM inference). Runs entirely on your own machine — no cloud AI required.

## Features

- **AI Chat** — powered by local Ollama models (llama, qwen, mistral, etc.)
- **GPT / Grok Relay** — optionally relay to ChatGPT or Grok via browser automation
- **Web Search** — Brave Search API integration
- **Voice Messages** — send/receive voice with TTS and Whisper transcription
- **YouTube Downloads** — download audio/video via yt-dlp
- **Torrent Search** — search and download via The Pirate Bay + aria2c
- **Stock Alerts** — price alerts with scheduled checks
- **Scheduled Messages** — morning digest, news drops, check-ins, evening prompts, night reflection
- **Reminders & Habits** — set reminders and track daily habits
- **Mood Tracking** — log and review mood over time
- **Memory** — persistent per-user chat history and personal notes
- **Browser Automation** — Playwright-powered browser control
- **Screen Capture / OCR** — screenshot and text extraction
- **Terminal Access** — optional shell command execution (disabled by default)
- **Multi-user** — allowlist-based access control with per-user session isolation
- **Cross-platform** — Linux, macOS, Windows (including WSL2)

## Requirements

- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com) (installed automatically by setup)
- Google Chrome / Chromium (for WhatsApp Web automation)

Optional (installed via setup wizard):
- `ffmpeg` — voice message processing
- `aria2c` — torrent/magnet downloads
- `yt-dlp` — YouTube downloads
- `espeak-ng` or `piper` — text-to-speech
- `faster-whisper` (Python) — voice transcription
- Playwright Chromium — browser automation / GPT relay

## Setup

```bash
git clone https://github.com/AgentLocal-hub/AgentLocal
cd whatsapp-ai-bot
npm install
npm run setup
```

The setup wizard will guide you through:
1. Installing all requirements
2. Scanning a QR code to link your WhatsApp
3. Configuring the bot name, personality, and AI model
4. Setting up API keys (optional — Brave Search, OpenAI)
5. Configuring the allowed numbers allowlist
6. Enabling/disabling tools
7. Setting workspace permissions
8. Building a custom system prompt

## Running

```bash
npm start
```

On first run the bot will send a greeting message to all numbers on the allowlist.

## Commands (in WhatsApp)

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/commands` | Quick command list |
| `remember [text]` | Save a memory note |
| `remind me [text] at [time]` | Set a reminder |
| `search [query]` | Web search |
| `find magnet [query]` | Torrent search |
| `youtube [url]` | Download YouTube audio |
| `stock alert [TICKER] [price]` | Set a stock price alert |
| `use gpt` / `use grok` | Switch AI relay |
| `use local` | Switch back to local Ollama |
| `/allowlist` | Show allowed numbers (admin) |
| `/allowlist add [number]` | Add a number (admin) |
| `/allowlist remove [number]` | Remove a number (admin) |

## GPT / Grok Relay

To use ChatGPT or Grok, open Chrome/Chromium with remote debugging enabled:

```bash
# Linux/macOS
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug

# Windows
chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\tmp\chrome-debug
```

Then log in to chatgpt.com or grok.com in that browser window. The bot will relay messages through it.

## Configuration

After running `npm run setup`, your config is stored in `data/bot_config.json`. You can re-run setup at any time to change settings, or edit the JSON directly.

Key config options:

```json
{
  "botName": "Bert",
  "model": "qwen2.5:7b-instruct",
  "allowedNumbers": ["+447700000000"],
  "tools": {
    "webSearch": true,
    "torrents": true,
    "youtube": true,
    "voice": true,
    "terminal": false,
    "gptRelay": true,
    "grokRelay": true
  }
}
```

## Security

- Only WhatsApp numbers on the `allowedNumbers` list can interact with the bot
- Terminal access (`tools.terminal`) is **disabled by default** — enable only if you understand the risks
- API keys are stored locally in `data/bot_config.json` — never commit this file
- The `.gitignore` excludes all sensitive files by default

## Platform Notes

| Platform | Notes |
|---|---|
| **Linux** | Full support. Uses `apt`/`dnf`/`pacman`/`yum` for dependency install |
| **macOS** | Full support. Uses Homebrew |
| **Windows (native)** | Supported. Uses `winget` where available |
| **WSL2** | Supported. Detected automatically |

## License

ISC
