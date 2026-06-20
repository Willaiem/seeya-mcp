# seeya-mcp

An [MCP](https://modelcontextprotocol.io) server that gives any MCP client **vision** — it analyzes images (screenshots, diagrams, UI mockups, photos) using a vision-capable model. Switch freely between **Google Gemini**, **Anthropic Claude**, and **opencode** backends at runtime.

## Getting started

Add the following to your MCP client config:

```json
{
  "mcpServers": {
    "seeya": {
      "command": "npx",
      "args": ["-y", "seeya-mcp@latest"],
      "env": {
        "GEMINI_API_KEY": "your-google-ai-studio-key"
      }
    }
  }
}
```

That's it — `npx` downloads and runs the server on demand. The default model is `google/gemini-2.5-flash`, so a `GEMINI_API_KEY` gets you running. Provide whichever key(s) match the backend you want (see below).

## Backends & credentials

Pick a backend per call (or persist a default) using `provider/model` ids. Each backend reads its own credentials from the environment:

| Backend | Provider prefix | Credential | Get one |
|---------|-----------------|-----------|---------|
| Google Gemini | `google/` | `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| Anthropic Claude | `anthropic/` | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| opencode | `opencode*/` | a running opencode server (`OPENCODE_BASE_URL`, default `http://127.0.0.1:4096`) | https://opencode.ai |

## Tools

| Tool | What it does |
|------|--------------|
| `analyze_image` | Analyze a local file path or `http(s)` URL, with an optional prompt. Optionally override the model for that one call. |
| `set_vision_model` | Set and persist the active vision model (`provider/model`). |
| `get_vision_model` | Return the currently active vision model. |
| `list_vision_models` | List vision-capable models across all backends. |

## Configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `GEMINI_API_KEY` | Google Gemini key | — |
| `ANTHROPIC_API_KEY` | Anthropic Claude key | — |
| `OPENCODE_BASE_URL` | opencode server URL | `http://127.0.0.1:4096` |
| `SEEYA_MCP_DEFAULT_MODEL` | Default model id | `google/gemini-2.5-flash` |
| `SEEYA_MCP_CONFIG` | Path to the persisted config file | `~/.seeya-mcp/config.json` |

## Requirements

- Node.js >= 20

## License

[MIT](./LICENSE)
