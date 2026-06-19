# PRD: seeya-mcp v2 — Multi-provider vision MCP with in-opencode model switching

## Problem Statement

As an opencode user, I use the `seeya-mcp` vision server to let a non-vision coding agent understand images (screenshots, UI mockups, diagrams, photos). Today the server only talks to Google Gemini, the model is fixed at startup via an environment variable, and I cannot change which vision model handles a given image without restarting opencode and editing MCP environment config. I also cannot route vision calls through my opencode Go subscription (which I'm already paying for and which exposes capable open-source models), nor through Anthropic Claude, even though I have credentials for both. The server is a single untyped JavaScript file with no tests, no build step, and no publish path, which makes adding any of these risky.

## Solution

Rewrite `seeya-mcp` in TypeScript as a modular MCP server (stdio transport, ESM) that supports three selectable vision backends — Google (direct), Anthropic (direct), and opencode (delegated via the opencode SDK, which reaches opencode Go-subscription and Zen models using opencode's existing auth) — and lets the user switch the active vision model from inside an opencode prompt, persistently, without restarting. Model selection uses opencode's `provider/model` id convention (e.g. `google/gemini-2.5-flash`, `anthropic/claude-sonnet-4-5`, `opencode-go/kimi-k2.7-code`); the prefix routes the call to the right backend. A discovery tool lists the models validated as vision-capable across all backends, and every selection is validated so a non-vision model is rejected with a clear message rather than failing opaquely at the provider.

## User Stories

1. As an opencode user, I want my existing `analyze_image` tool to keep working after the rewrite, so that my current prompts and AGENTS.md rules don't break.
2. As an opencode user, I want to change the vision model that `analyze_image` uses by asking the agent to call a tool from the opencode prompt, so that I don't have to restart opencode or edit config files.
3. As an opencode user, I want the active vision model choice to persist across opencode restarts and across sessions, so that I set it once and forget it.
4. As an opencode user, I want to override the default model for a single `analyze_image` call by passing a model argument, so that I can use a cheaper model for one image without changing my global default.
5. As an opencode user, I want to ask the agent which vision models are available, so that I don't have to memorize valid model ids.
6. As an opencode user, I want to ask the agent what the currently active vision model is, so that I can confirm a switch took effect.
7. As an opencode user with an opencode Go subscription, I want to route vision calls through opencode so that I reuse my existing Go auth and don't have to paste separate provider API keys into the MCP server.
8. As an opencode user, I want to use opencode Go-subscription models that empirically accept images (Kimi K2.7 Code, Kimi K2.6, MiMo-V2.5, Qwen3.7 Plus, Qwen3.6 Plus, MiniMax M3) for vision, so that I can spend my Go quota on image analysis.
9. As an opencode user, I want to use Anthropic Claude as a vision backend with my own Anthropic API key, so that I can pick Claude for tasks where it analyzes images best.
10. As an opencode user, I want to keep using Google Gemini as a vision backend with my own Google API key, so that the rewrite doesn't regress my current workflow.
11. As an opencode user, I want the server to start even if I haven't configured every provider's API key, so that I can use just the opencode backend without a Google or Anthropic key.
12. As an opencode user, I want a missing API key to be reported only when I actually try to use the backend that needs it, so that the error message tells me exactly which key to set.
13. As an opencode user, when I pick a model that can't handle images, I want a clear error telling me the model isn't vision-capable and pointing me at `list_vision_models`, so that I don't get a confusing provider-side failure.
14. As an opencode user, when I pass a malformed model id (no `/`, unknown prefix), I want a clear error explaining the `provider/model` format, so that I can correct it.
15. As an opencode user, I want image loading to keep supporting both local file paths and http(s) URLs, so that I can analyze screenshots on disk and remote images alike.
16. As an opencode user, I want the 20 MB image size limit and mime-type detection to keep working, so that oversized or non-image inputs are rejected before they reach the model.
17. As an opencode user, I want the opencode backend to use my already-running opencode server (port 4096 by default), so that vision calls reuse my authenticated session without spawning a second opencode instance.
18. As an opencode user, I want to point the opencode backend at a non-default opencode server URL via an environment variable, so that it works when opencode is running on a random port or another host.
19. As an opencode user, I want vision calls made through the opencode backend to not leave leftover sessions in my `/sessions` list, so that ad-hoc image analysis doesn't clutter my history.
20. As an opencode user, I want the vision response to be just the model's textual answer, so that reasoning traces and tool-call noise don't pollute the result the agent reads.
21. As an opencode user, I want tool-call errors to keep the existing shape (text content with `isError: true`), so that the agent's error-handling behavior doesn't change.
22. As an opencode user, I want to install and run the server locally via `node dist/index.mjs` (or `npx .`), so that I can register it in `opencode.json` as a local MCP server.
23. As an opencode user, I want the package to be publish-ready so that flipping it to public npm later is trivial, even though I run it locally for now.
24. As an opencode user, I want the default vision model to be `google/gemini-2.5-flash`, so that a fresh install behaves like the current server until I switch.
25. As an opencode user with no Google key on a fresh install, I want the first `analyze_image` call to fail with a message listing alternatives (set `GEMINI_API_KEY`, or call `set_vision_model` with an opencode/anthropic model), so that I'm guided to a working configuration.
26. As an opencode user, I want to override the default model on first run via an environment variable, so that I can bake a non-Google default into my `opencode.json` environment block.
27. As a maintainer, I want the codebase in TypeScript with strict types, so that refactors and backend additions are caught at compile time.
28. As a maintainer, I want each vision backend behind a shared interface, so that adding a fourth provider later is a new file plus a router entry.
29. As a maintainer, I want a build step that emits a single bundled ESM file plus type declarations, so that opencode launches one stable entry point.
30. As a maintainer, I want typecheck and lint commands, so that CI (and my coding agent) can verify correctness.
31. As a maintainer, I want automated tests with no network calls, so that the suite runs fast and reliably in CI.
32. As a maintainer, I want the pure-logic modules (model-id parsing, routing, allowlists, config persistence, image loading) tested in isolation, so that regressions in routing or validation are caught without spinning up backends.
33. As a maintainer, I want each backend tested with its SDK mocked, so that I can verify call shapes and error handling without real API keys.
34. As a maintainer, I want the MCP tool handlers tested end-to-end with backends mocked, so that the wiring between config, models, image loading, and backends is verified.

## Implementation Decisions

- **Transport**: MCP server over stdio, ESM. The single existing `index.mjs` and the `GEMINI_MODEL` env var are removed.
- **Three backends**, selected by the prefix of an opencode-style `provider/model` id:
  - `google/*` → direct calls via `@google/genai` (existing dependency, retained).
  - `anthropic/*` → direct calls via `@anthropic-ai/sdk` (new dependency). Image is sent as an image content block plus text; the simple single-turn messages API is used (not the Anthropic Agent SDK, which would import a competing agent runtime for no benefit).
  - `opencode*/*` (matches `opencode` and `opencode-go` provider prefixes) → delegated via `@opencode-ai/sdk` (new dependency) to a running opencode server. Opencode already holds Go-subscription and Zen auth and routes to every model under those prefixes, so one integration covers all opencode models; no per-provider keys live in the MCP server.
- **opencode backend mechanics** (verified against opencode's generated SDK types): create a client with `createOpencodeClient({ baseUrl })`; per call, create an ephemeral session, call `session.prompt` with `model: { providerID, modelID }` and `parts: [ TextPart({type:"text", text: prompt}), FilePartInput({type:"file", mime, url: <data: URL of the image>}) ]`, concatenate the assistant `TextPart` texts from the response, then delete the session best-effort. Opencode has no dedicated image part; images ride on `FilePartInput.url` as a data URL. Reasoning/tool parts are ignored.
- **opencode server discovery**: opencode's local MCP children inherit the parent `process.env` plus the config's `environment` block; opencode does not inject its server URL. The opencode server tries port 4096 first, then falls back to a random port. The backend therefore defaults `baseUrl` to `http://127.0.0.1:4096` and lets the user override it via `OPENCODE_BASE_URL`.
- **Model id scheme**: one string, `provider/model`. The prefix routes to a backend. This matches opencode's `-m provider/model` convention and the `opencode models` output.
- **Model switching**: four MCP tools are exposed.
  - `analyze_image({ image, prompt?, model? })` — image is a local path or http(s) URL; optional `prompt` defaults to the existing detailed-description instruction; optional `model` overrides the persisted default for this call only.
  - `set_vision_model({ model })` — validates the id, persists it, returns confirmation.
  - `get_vision_model()` — returns the active default.
  - `list_vision_models()` — enumerates validated vision models across all three backends.
- **Persistence**: active model stored in `~/.seeya-mcp/config.json` as `{ "model": "<provider/model>" }`. Path overridable via `SEEYA_MCP_CONFIG`. `set_vision_model` writes it; `get_vision_model` and `analyze_image` read it.
- **Validation**:
  - Google and Anthropic direct backends use a maintained vision-model allowlist (e.g. `gemini-2.5-flash`, `claude-sonnet-4-5`); non-allowlisted ids are rejected.
  - opencode backend accepts a model if opencode reports `capabilities.input.image === true` (covers Zen vision models) OR the model id is in the empirically-tested Go-subscription vision set: `{ kimi-k2.7-code, kimi-k2.6, mimo-v2.5, qwen3.7-plus, qwen3.6-plus, minimax-m3 }`. This override exists because opencode's capability flag underreports these tested Go models.
  - `list_vision_models` returns the union of valid models across backends.
- **Config & env** (no API key required at startup; each backend checks its own key lazily when selected):
  - `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` — direct-backend credentials.
  - `OPENCODE_BASE_URL` — opencode server URL, default `http://127.0.0.1:4096`.
  - `SEEYA_MCP_CONFIG` — config file path, default `~/.seeya-mcp/config.json`.
  - `SEEYA_MCP_DEFAULT_MODEL` — overrides the config file's model on first run / when unset.
  - `SEEYA_MCP_MAX_BYTES` — image size limit, default 20 MB.
  - Default model `google/gemini-2.5-flash`. The old `GEMINI_MODEL` env var is removed in favor of the `provider/model` scheme.
- **Toolchain**: TypeScript (strict), built with `tsup` (esbuild) to a single bundled `dist/index.mjs` (ESM) with `.d.ts` emitted. Package manager npm. Node 20 LTS+ target. `package.json` keeps `"type": "module"`.
- **Project structure** (modular, deep modules with simple interfaces):
  - `src/image.ts` — `loadImage(input): Promise<{dataUrl, mimeType, bytes}>`. Encapsulates URL-fetch vs local-file, mime sniffing, size limit. Deep I/O seam.
  - `src/config.ts` — `getConfig()` / `setModel(id)`. Encapsulates config path resolution, env overrides, defaults.
  - `src/models.ts` — `parseModelId(id)` / `isVisionModel(id, backend)` / `listVisionModels()`. Pure: prefix routing, allowlists, tested-Go set.
  - `src/backends/types.ts` — `Backend` interface: `analyze(ctx, image, prompt, model): Promise<string>`, `listModels(): Promise<string[]>`, `validate(model): Promise<ValidationResult>`. The seam that makes backends independently testable.
  - `src/backends/google.ts`, `src/backends/anthropic.ts`, `src/backends/opencode.ts` — one implementation of `Backend` per provider.
  - `src/backends/index.ts` — `route(modelId): Backend` (prefix → backend).
  - `src/tools.ts` — MCP tool schemas and descriptions (static).
  - `src/server.ts` — MCP server and the four tool handlers; orchestrates config, models, image, backends.
  - `src/index.ts` — entry point; stdio transport. Thin.
  - `src/errors.ts` — `toMcpError(msg)` helper.
- **Packaging & launch**: `private: true` (local only for now) but publish-ready — `bin` points at `dist/index.mjs`, `files` lists `dist`, `build` and `start` npm scripts added. opencode.json registers it as: `{ "type": "local", "command": ["node", "dist/index.mjs"], "cwd": "<repo>", "environment": { "GEMINI_API_KEY": "{env:GEMINI_API_KEY}", "ANTHROPIC_API_KEY": "{env:ANTHROPIC_API_KEY}", "OPENCODE_BASE_URL": "http://127.0.0.1:4096" } }`.
- **Error shape**: unchanged — `{ content: [{ type: "text", text }], isError: true }`. Logging to stderr.
- **Lint**: Biome (lightweight, fits the opencode-ai ecosystem).
- **Go vs Zen clarification**: opencode Go-subscription models are coding-focused and most report no image capability, but the six listed above were empirically confirmed to accept images. The opencode backend therefore routes through opencode's API/auth (satisfying the "opencode API" goal) and accepts those tested Go models for vision, while filtering out untested Go models (e.g. glm-5.2, deepseek-v4) that would reject images. Zen vision models (Claude/Gemini via opencode auth) are accepted via the capability flag.

## Testing Decisions

- **What makes a good test**: tests assert external behavior (inputs → outputs / observable effects), not implementation details. A test should keep passing when a module's internals are refactored as long as its interface contract holds. No test makes a real network call or uses a real API key.
- **Framework**: Vitest, matching the tsup/esbuild toolchain.
- **Modules tested**:
  - `src/models.ts` (highest priority): model-id parsing, prefix→backend routing, vision allowlist acceptance/rejection, the tested-Go set override, `list_vision_models` aggregation. Pure logic; fast table-driven tests.
  - `src/config.ts`: config file read/write, default model, env override precedence (`SEEYA_MCP_DEFAULT_MODEL`, `SEEYA_MCP_CONFIG` path), missing-file handling. Uses temp directories for isolation.
  - `src/image.ts`: local-file loading, http(s) URL fetching (with `fetch` mocked), mime detection by extension and by content-type, 20 MB size-limit rejection, non-image content-type rejection. Uses temp files and mocked `fetch`.
  - `src/backends/google.ts`, `src/backends/anthropic.ts`, `src/backends/opencode.ts`: each backend's `analyze`/`listModels`/`validate` with its SDK mocked — verify the correct call shape (e.g. opencode backend sends `FilePartInput` with a data URL and creates/deletes an ephemeral session; Anthropic backend sends an image content block), error propagation, and lazy key validation. No real SDK calls.
  - `src/server.ts`: end-to-end MCP tool-handler tests with backends mocked — `analyze_image` (with and without per-call model override, with persisted default), `set_vision_model` (persists + validates), `get_vision_model`, `list_vision_models`, and error paths (unknown tool, malformed model id, non-vision model, missing key). Verifies the wiring between config, models, image loading, and backends.
- **Prior art**: the current repo has no tests; this PRD establishes the testing baseline.
- **Out of scope for tests**: live integration tests that call real vision models (an opt-in `SEEYA_MCP_LIVE=1` suite was considered and deferred).

## Out of Scope

- Publishing the package to the public npm registry (it is made publish-ready but stays `private: true`).
- A live integration test suite that calls real vision models with real API keys.
- Switching the transport away from MCP (e.g. to the Anthropic Agent SDK or ACP) — MCP over stdio remains the only transport.
- Supporting MCP transports other than stdio (HTTP/SSE remote MCP server) in this revision.
- Per-agent or per-session model selection inside opencode — the persisted model is global to the MCP server process.
- Adding vision backends beyond Google, Anthropic, and opencode (the `Backend` interface is designed to make a fourth provider a new file plus a router entry, but none is built now).
- Caching vision responses or image data across calls.
- Streaming vision responses back through MCP (results are returned as a single text content block).
- Rewriting opencode itself or modifying how opencode injects env into MCP children.

## Further Notes

- The rewrite preserves the existing tool name (`analyze_image`) and its core arguments (`image`, `prompt`) so that current `AGENTS.md` rules and user habits keep working; the only additive change is an optional `model` argument and three new sibling tools.
- Empirical vision-capability findings for opencode Go models (the six-model tested set) are encoded as a hardcoded allowlist because opencode's `capabilities.input.image` flag underreports them; if opencode later reports these accurately, the allowlist can be dropped in favor of the flag alone.
- The opencode backend's reliance on port 4096 is a default, not a guarantee: when opencode's TUI picks a random port, the user must set `OPENCODE_BASE_URL` in the MCP server's `environment` block. This is documented in the error message emitted when the backend can't reach opencode.
- Ephemeral sessions used by the opencode backend are deleted best-effort; if deletion fails (e.g. opencode restarted mid-call), a leftover empty session may remain — acceptable tradeoff for not polluting session history on the happy path.
