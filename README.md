# model-router

An OpenAI-compatible proxy that classifies each conversation turn by complexity and routes it to the most cost-effective Claude model. Sits between your AI gateway (e.g. OpenClaw) and Anthropic's API.

No dashboard, no database, no framework, no telemetry. Just classify, route, log.

## Before you start

- **OpenClaw**: This proxy works with OpenClaw 2026.3.2+. [Install OpenClaw first](https://docs.openclaw.ai/installation) if you don't have it.
- **Anthropic API key**: Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.
- **System access**: You'll need `sudo` to install the systemd service (or run it manually).

## How it works

```
Your app / OpenClaw (model: router/auto)
        ↓
  localhost:3456/v1/chat/completions
        ↓
  [Classify last user message]
  [Pick model: Haiku / Sonnet / Opus]
        ↓
  Anthropic API (/v1/messages)
        ↓
  [Translate response → OpenAI format]
        ↓
  Return to caller
```

The proxy accepts requests in **OpenAI format**, classifies the last user message using a fast rule-based classifier (no LLM call), translates the request to **Anthropic format**, forwards it, and translates the response back.

## Classification rules

Priority order — first match wins:

| # | Rule | Tier | Model |
|---|------|------|-------|
| 1 | `/opus` in message | complex | Opus |
| 2 | `/cheap` in message | simple | Haiku |
| 3 | Test hook: `router-test-simple` / `router-test-complex` | simple / complex | Haiku / Opus |
| 4 | Heartbeat / system messages | standard | Sonnet |
| 5 | Reasoning keywords (prove, theorem, induction, ...) | complex | Opus |
| 6 | Complexity keywords (refactor, architecture, migration, ...) | complex | Opus |
| 7 | Tool use keywords (deploy, docker, ssh, curl, ...) | standard | Sonnet |
| 8 | Short message (< 80 chars) | simple | Haiku |
| 9 | Default | standard | Sonnet |

All thresholds and keyword lists are configurable.

## Format translation

The proxy handles full bidirectional translation between OpenAI and Anthropic formats:

- **System messages**: extracted from the messages array → Anthropic top-level `system` field
- **Tool calls**: OpenAI `tool_calls` ↔ Anthropic `tool_use` content blocks
- **Tool results**: OpenAI `role: "tool"` messages ↔ Anthropic `tool_result` content blocks (grouped into user messages)
- **Tool definitions**: OpenAI `function.parameters` ↔ Anthropic `input_schema`
- **Stop reasons**: `end_turn` → `stop`, `max_tokens` → `length`, `tool_use` → `tool_calls`
- **Usage**: `input_tokens` → `prompt_tokens`, `output_tokens` → `completion_tokens`

## Installation

### Prerequisites

- Node.js 18+
- An Anthropic API key

### Build

```bash
git clone https://github.com/hopthings/model-router.git
cd model-router
npm install
npm run build
```

### Run

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

The proxy starts on `http://127.0.0.1:3456` (localhost only).

## Configuration

Edit `config.json` in the project root. Changes take effect on next request (no restart needed).

```json
{
  "port": 3456,
  "tiers": {
    "simple": "claude-haiku-4-5-20251001",
    "standard": "claude-sonnet-4-20250514",
    "complex": "claude-opus-4-6"
  },
  "rules": {
    "shortCharsSimple": 80,
    "forceStandardIfLikelyToolUse": true
  },
  "overrides": {
    "forceComplexRegex": "^/opus\\b",
    "forceSimpleRegex": "^/cheap\\b"
  }
}
```

| Field | Description |
|-------|-------------|
| `port` | Port the proxy listens on |
| `tiers.simple` | Anthropic model ID for simple messages |
| `tiers.standard` | Anthropic model ID for standard messages |
| `tiers.complex` | Anthropic model ID for complex messages |
| `rules.shortCharsSimple` | Messages shorter than this (chars) route to simple |
| `rules.forceStandardIfLikelyToolUse` | Floor tool-use messages to standard tier |
| `overrides.forceComplexRegex` | Regex to force complex tier |
| `overrides.forceSimpleRegex` | Regex to force simple tier |

The `tiers` values are **Anthropic model IDs** (not prefixed with `anthropic/`).

## OpenClaw integration

Add the proxy as a provider in your OpenClaw config:

```json
{
  "models": {
    "providers": {
      "router": {
        "baseUrl": "http://127.0.0.1:3456/v1",
        "api": "openai-completions",
        "apiKey": "local-no-auth",
        "models": [{"id": "auto", "name": "auto"}]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "router/auto",
        "fallbacks": ["anthropic/claude-sonnet-4-20250514"]
      }
    }
  }
}
```

## Running as a systemd service

Create `/etc/systemd/system/model-router.service`:

```ini
[Unit]
Description=Model Router Proxy
After=network.target

[Service]
Type=simple
User=ubuntu
Environment=ANTHROPIC_API_KEY=sk-ant-...
WorkingDirectory=/path/to/model-router
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable model-router
sudo systemctl start model-router

# Check logs
journalctl -u model-router -f
```

## Testing

### Health check

```bash
curl http://localhost:3456/health
# → {"status":"ok"}
```

### Non-streaming

```bash
curl -s http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}],"max_tokens":50}' | jq .
```

### Test routing

```bash
# Should route to Haiku
curl -s http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"router-test-simple"}],"max_tokens":50}' | jq .

# Should route to Opus
curl -s http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"router-test-complex"}],"max_tokens":50}' | jq .
```

### Streaming

```bash
curl -N http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}],"max_tokens":50,"stream":true}'
```

## Logging

Every request logs one line to stdout:

```
[router] 13:32:01 "router-test-simple" → simple → claude-haiku-4-5-20251001 (test hook)
[router] 13:32:15 "Write an article about AI governance" → complex → claude-opus-4-6 (complexity indicators)
[router] 13:32:30 "hi" → simple → claude-haiku-4-5-20251001 (short message, 2 chars)
[router] 13:33:00 "check my notion planner" → standard → claude-sonnet-4-20250514 (likely tool use)
```

When running as a systemd service, view logs with `journalctl -u model-router`.

## Project structure

```
model-router/
├── src/
│   ├── server.ts          # HTTP server, single POST endpoint
│   ├── classifier.ts      # Rule-based complexity classifier
│   ├── translator.ts      # OpenAI ↔ Anthropic format translation
│   ├── anthropic.ts       # Anthropic API client
│   ├── config.ts          # Config loader
│   └── types.ts           # Shared type definitions
├── config.json            # Routing config (user-editable)
├── package.json
└── tsconfig.json
```

## License

MIT
