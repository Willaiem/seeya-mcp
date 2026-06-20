# seeya-mcp

An [MCP](https://modelcontextprotocol.io) server that gives a non-vision agent the ability to **analyze images** (screenshots, diagrams, UI mockups, photos) using a vision-capable model. Switch freely between one of three providers:

| Provider prefix     | Backend          | Auth                                            |
| ------------------- | ---------------- | ----------------------------------------------- |
| `google/*`          | `@google/genai`  | `GEMINI_API_KEY`                                |
| `anthropic/*`       | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY`                          |
| `opencode*/*`       | `@opencode-ai/sdk`  | none — reuses your local opencode go/zen subscription |

Models are addressed with an opencode-style `provider/model` id, e.g. `google/gemini-2.5-flash`, `anthropic/claude-sonnet-4-6`, `opencode-go/kimi-k2.7-code`.

## Getting started

Add the following to your MCP client config:

```json
{
  "mcpServers": {
    "seeya": {
      "command": "npx",
      "args": ["-y", "seeya-mcp@latest"],
      "env": {
        "GEMINI_API_KEY": "your-google-ai-studio-key",
        "ANTHROPIC_API_KEY": "your Anthropic API key, but if you want to use OAuth from Claude Code instead then skip it"
      }
    }
  }
}
```

The default model is `google/gemini-2.5-flash`, so a `GEMINI_API_KEY` gets you running. Provide whichever key(s) match the backend you want (see below).

## Tools

| Tool | What it does |
|------|--------------|
| `analyze_image` | Analyze a local file path or `http(s)` URL, with an optional prompt. Optionally override the model for that one call. |
| `set_vision_model` | Set and persist the active vision model (`provider/model`). |
| `get_vision_model` | Return the currently active vision model. |
| `list_vision_models` | List vision-capable models across all backends. |

## Configuration

| Env var                   | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `GEMINI_API_KEY`          | Auth for `google/*` models.                                             |
| `ANTHROPIC_API_KEY`       | Auth for `anthropic/*` models.                                          |
| `OPENCODE_BASE_URL`       | Point the opencode backend at a specific server (see below). Optional.  |
| `SEEYA_MCP_DEFAULT_MODEL` | Default model when no config file exists (built-in default `google/gemini-2.5-flash`). |
| `SEEYA_MCP_CONFIG`        | Override the config file path.                                          |

The active model persists to `~/.seeya-mcp/config.json` (`{ "model": "provider/model" }`) and survives restarts. Switch it at runtime with `set_vision_model`.

## opencode connectivity

opencode's HTTP server uses a **random, undiscoverable port** when you run the TUI (only `opencode serve` defaults to `4096`), and there is no env var or lock file that exposes it ([opencode#9099](https://github.com/anomalyco/opencode/issues/9099)). So seeya-mcp does not try to find your running opencode — it resolves a server in one of two ways:

1. **`OPENCODE_BASE_URL` is set** → it talks to that URL verbatim. Use this to point at an `opencode serve` you manage, or a TUI pinned to a fixed port (`{ "server": { "port": 4096 } }` in your opencode config).
2. **Otherwise (default)** → it spawns its own private `opencode serve` on a free port, reads the port opencode actually bound, and reuses that server for the process lifetime. This works **whether or not a TUI is running** — it just needs the `opencode` CLI on `PATH` and your existing opencode auth (the spawned server reads the same config, providers, and `opencode-go` / Zen models).

Notes:

- The first `analyze_image` call pays a ~2–4s cold start while the server spawns; subsequent calls reuse it.
- The managed server is torn down on `exit`/`SIGINT`/`SIGTERM`. On a Windows force-kill it may linger as an idle process.
- If you set `OPENCODE_SERVER_PASSWORD`, prefer running your own authed `opencode serve` and setting `OPENCODE_BASE_URL` — the spawned server inherits the password but the client won't send it.

## Development

```sh
npm i
npm run build
npx @modelcontextprotocol/inspector node dist/index.mjs 
```

## Requirements

- Node.js >= 20

## License

[MIT](./LICENSE)
