# Skill: tts

**Version:** 1.0.0  
**Domain:** audio

## Description

Text-to-speech synthesis with multiple provider backends. Converts operator messages, AI responses, or status reports to audio. Supports streaming and voice listing.

## When to Use

Invoke when the user asks about:
- Converting text or a report to audio/speech
- Generating voice announcements for community broadcasts
- Listing available voices from a provider
- Streaming speech in real time

## Tools

| Action | Description |
|---|---|
| `synthesize` | Convert text to audio file (mp3/wav/ogg/opus) |
| `stream` | Stream audio in real time |
| `voices` | List available voices for the selected provider |

## Providers

| Provider | Description |
|---|---|
| `edge` (default) | Microsoft Edge TTS (free, no API key) |
| `openai` | OpenAI TTS API |
| `elevenlabs` | ElevenLabs high-quality voices |
| `google` | Google Cloud Text-to-Speech |
| `local` | Local offline TTS engine |

## Example: Synthesize

```json
{
  "action": "synthesize",
  "provider": "edge",
  "text": "AgentOS: System health check complete. All systems nominal.",
  "voice": "en-ZA-LukeNeural",
  "speed": 1.0,
  "format": "mp3",
  "language": "en"
}
```

## Permissions

- `audio:synthesize` — required for all TTS actions
