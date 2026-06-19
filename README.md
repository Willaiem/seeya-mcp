# seeya-mcp

An [MCP](https://modelcontextprotocol.io) server that gives a non-vision agent the ability to **look at images**. It exposes one `analyze_image` tool backed by a selectable vision model, routed to one of three providers:

| Provider prefix     | Backend          | Auth                                            |
| ------------------- | ---------------- | ----------------------------------------------- |
| `google/*`          | `@google/genai`  | `GEMINI_API_KEY`                                |
| `anthropic/*`       | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY`                          |
| `opencode*/*`       | `@opencode-ai/sdk`  | none — reuses your local opencode go/zen subscription |

Models are addressed with an opencode-style `provider/model` id, e.g. `google/gemini-2.5-flash`, `anthropic/claude-sonnet-4-6`, `opencode-go/kimi-k2.7-code`.

## Tools

- **`analyze_image`** — analyze a local file path or `http(s)` URL with an optional `prompt`. Uses the active model unless a per-call `model` (provider/model) override is given.
- **`set_vision_model`** — set and persist the active model (`provider/model`).
- **`get_vision_model`** — return the active model id.
- **`list_vision_models`** — list vision-capable models across all backends, one `provider/model` per line.

## Install & build

Requires Node ≥ 20.

```sh
npm install
npm run build      # bundles to dist/index.mjs (the bin)
npm test           # vitest
```

## Register with opencode (or any MCP host)

Add it as a local MCP server. A ready-to-edit snippet lives in [`docs/opencode-registration.json`](docs/opencode-registration.json):

```jsonc
{
  "mcp": {
    "seeya-mcp": {
      "type": "local",
      "command": ["node", "dist/index.mjs"],
      "cwd": "/absolute/path/to/seeya-mcp",
      "environment": {
        "GEMINI_API_KEY": "{env:GEMINI_API_KEY}",
        "ANTHROPIC_API_KEY": "{env:ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

The server starts without any keys — a backend only complains about a missing key when you actually select a model that needs it. Only the `opencode*` backend works key-free.

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
npm run typecheck
npm run lint        # biome; lint:fix to autofix
npm test
```
