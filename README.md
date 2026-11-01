# opencode-speak

Free text-to-speech for OpenCode. Auto-reads the visible session's replies
aloud — each TUI window speaks only what it is showing. Speech is normalized
to speakable text by your existing OpenCode Go model. No extra API keys, no
local LLM server, no paid TTS.

Speech-to-text is intentionally out of scope — pair it with Vibe Typer.

## Engines

| Engine | Voice quality | Requirements |
|---|---|---|
| `edge` (default) | Neural, natural | `edge-tts` on PATH (`uv tool install edge-tts`) + internet |
| `say` | Robotic, offline | Built-in macOS, zero setup |

`voice` is the engine voice: an Edge id like `en-US-AriaNeural`
(`edge-tts --list-voices` lists them) or a `say` name (`say -v '?'`).
`sayVoice` is the fallback voice if Edge is missing or fails. New speech
preempts old; playback is a temp MP3 (Edge) or direct synth (`say`).

## How it works

1. Session turn ends in the window you are viewing.
2. The TUI collects assistant messages since the last user message.
3. Your Go model (default `opencode-go/deepseek-v4.1-flash`) rewrites the
   markdown into speakable text (narrate / summarize / notify, adapted from
   `renjfk/opencode-voice`, MIT).
4. The TUI synthesizes it locally. Normalization failure falls back to
   truncated plain text, never silence.

Background sessions stay silent; manual read (`leader+s`) works anywhere.

## Install

```sh
cd /Users/azizf/Development/opencode-speak
npm install
```

Project-local (`opencode.jsonc` in your repo):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "/Users/azizf/Development/opencode-speak",
      "options": {
        "enabled": false,
        "engine": "edge",
        "voice": "en-US-AriaNeural",
        "sayVoice": "Samantha",
        "normalizeProvider": "opencode-go",
        "normalizeModel": "deepseek-v4.1-flash",
        "maxChars": 800,
        "debugLog": true
      }
    }
  ]
}
```

Set `"enabled": true` to have speaking on from the start (default is off).
Set `"debugLog": true` to append diagnostics to
`~/.local/state/opencode-speak/debug.log` (setup, events, skips, normalize
timing, speak start/stop).

Or global (`~/.config/opencode/opencode.jsonc`), same shape. One entry loads
both server and TUI parts. Config reloads without restart (`/reload` to force).

## Requirements

- macOS with `say` (preinstalled — verify with `say -v '?'`).
- OpenCode Go connected (`/connect` → OpenCode Go) with a model available.
- **DeepSeek models require Regions = Global** in Console Settings › Privacy,
  otherwise normalization calls are blocked. Alternatively set
  `normalizeModel: "claude-haiku-5-5"`.

## Use

| Command | Keybind | What |
|---|---|---|
| `/speak-on` | `leader+v` (toggle) | Auto read-aloud on |
| `/speak-off` | `leader+v` (toggle) | Auto read-aloud off + stop |
| `/tts-speak` | `leader+s` | Read last response in detail |
| `/speak-stop` | `escape` | Stop playback (falls through when idle) |

Off by default on first install.

## Attribution

Normalization prompts adapted from
[renjfk/opencode-voice](https://github.com/renjfk/opencode-voice) (MIT).
