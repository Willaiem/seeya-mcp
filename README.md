# seeya-mcp

An [MCP](https://modelcontextprotocol.io) server that gives a non-vision agent the ability to **analyze images** (screenshots, diagrams, UI mockups, photos) using a vision-capable model. Switch freely between one of three providers:

| Provider prefix     | Backend          | Auth                                            |
| ------------------- | ---------------- | ----------------------------------------------- |
| `google/*`          | `@google/genai`  | `GEMINI_API_KEY`                                |
| `anthropic/*`       | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY`, or none — falls back to your local Claude Code CLI subscription |
| `opencode*/*`       | `@opencode-ai/sdk`  | none — reuses your local opencode go/zen subscription |

Models are addressed with an opencode-style `provider/model` id, e.g. `google/gemini-2.5-flash`, `anthropic/claude-sonnet-4-6`, `opencode-go/kimi-k2.7-code`.

## Getting started

Add the following to your MCP client config:

```json
{
  "mcpServers": {
    "seeya": {
      "type": "local",
      "command": [
          "npx",
          "-y",
          "seeya-mcp@latest"
      ],
      "env": {
        "GEMINI_API_KEY": "your-google-ai-studio-key",
        "ANTHROPIC_API_KEY": "your-anthropic-api-key (omit to use your Claude Code CLI subscription instead)"
      },
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
| `ANTHROPIC_API_KEY`       | Auth for `anthropic/*` models. When unset, the backend shells out to the Claude Code CLI instead (see below). |
| `OPENCODE_BASE_URL`       | Point the opencode backend at a specific server (see below). Optional.  |
| `SEEYA_MCP_DEFAULT_MODEL` | Default model when no config file exists (built-in default `google/gemini-2.5-flash`). |
| `SEEYA_MCP_CONFIG`        | Override the config file path.                                          |

The active model persists to `~/.seeya-mcp/config.json` (`{ "model": "provider/model" }`) and survives restarts. Switch it at runtime with `set_vision_model`.

## Anthropic without an API key (Claude Code subscription)

If `ANTHROPIC_API_KEY` is **not** set, the `anthropic/*` backend doesn't call the Anthropic SDK — it shells out to the locally installed [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI (`claude -p`), which uses whatever auth Claude Code already has (e.g. your **Pro/Max subscription** via OAuth). No key needed.

How it works: the loaded image is written to a throwaway temp dir, `claude -p --model <id> --allowedTools Read --output-format json` runs there with the prompt piped over stdin, and its Read tool loads the image. The result text is returned to the caller.

Requirements & notes:

- The `claude` CLI must be installed and on `PATH` (`npm i -g @anthropic-ai/claude-code`) and signed in. If it's missing, `analyze_image` returns a clear error telling you to install it or set `ANTHROPIC_API_KEY`.
- The CLI path runs an extra model turn (to call the Read tool), so it's a little slower than the direct SDK call.
- Set `ANTHROPIC_API_KEY` to skip the CLI entirely and talk to the API directly.

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
npm run dev
```

## Requirements

- Node.js >= 20

## License

[MIT](./LICENSE)
