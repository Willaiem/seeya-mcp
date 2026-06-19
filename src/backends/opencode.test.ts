import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionPrompt: vi.fn(),
  sessionDelete: vi.fn(),
  providerList: vi.fn(),
}));

vi.mock("@opencode-ai/sdk", () => ({
  createOpencodeClient: () => ({
    session: {
      create: mocks.sessionCreate,
      prompt: mocks.sessionPrompt,
      delete: mocks.sessionDelete,
    },
    provider: { list: mocks.providerList },
  }),
}));

// Keep these backend tests hermetic: no real subprocess spawn. The resolver's own
// behavior (override vs. managed spawn) is covered in opencode-server.test.ts.
vi.mock("./opencode-server.js", () => ({
  resolveOpencodeBaseUrl: vi.fn(
    async () => process.env.OPENCODE_BASE_URL?.trim() || "http://127.0.0.1:4096",
  ),
  usingManagedServer: vi.fn(() => !process.env.OPENCODE_BASE_URL?.trim()),
}));

import { OpencodeBackend } from "./opencode.js";

const PARSED = {
  providerID: "opencode-go",
  modelID: "kimi-k2.7-code",
  backend: "opencode",
} as const;
const IMAGE = { dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 };

beforeEach(() => {
  mocks.sessionCreate.mockReset();
  mocks.sessionPrompt.mockReset();
  mocks.sessionDelete.mockReset();
  mocks.providerList.mockReset();
  mocks.sessionDelete.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.OPENCODE_BASE_URL;
});

function ok<T>(data: T) {
  return { data, error: undefined, request: {}, response: {} };
}
function err(error: unknown) {
  return { data: undefined, error, request: {}, response: {} };
}

describe("OpencodeBackend.validate", () => {
  it("accepts a tested-Go model without contacting opencode", async () => {
    const backend = new OpencodeBackend();
    expect((await backend.validate(PARSED)).valid).toBe(true);
    expect(mocks.providerList).not.toHaveBeenCalled();
  });

  it("accepts an opencode model that reports the image modality", async () => {
    mocks.providerList.mockResolvedValue(
      ok({
        all: [
          {
            id: "opencode-go",
            models: {
              "zen-vision-model": { attachment: false, modalities: { input: ["text", "image"] } },
            },
          },
        ],
      }),
    );
    const result = await new OpencodeBackend().validate({ ...PARSED, modelID: "zen-vision-model" });
    expect(result.valid).toBe(true);
  });

  it("accepts an opencode model with attachment=true", async () => {
    mocks.providerList.mockResolvedValue(
      ok({ all: [{ id: "opencode-go", models: { "att-model": { attachment: true } } }] }),
    );
    const result = await new OpencodeBackend().validate({ ...PARSED, modelID: "att-model" });
    expect(result.valid).toBe(true);
  });

  it("rejects an opencode model that is not vision-capable", async () => {
    mocks.providerList.mockResolvedValue(
      ok({
        all: [
          {
            id: "opencode-go",
            models: { "glm-5.2": { attachment: false, modalities: { input: ["text"] } } },
          },
        ],
      }),
    );
    const result = await new OpencodeBackend().validate({ ...PARSED, modelID: "glm-5.2" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not vision-capable/);
  });

  it("rejects when the model is not listed under the provider", async () => {
    mocks.providerList.mockResolvedValue(ok({ all: [{ id: "opencode-go", models: {} }] }));
    const result = await new OpencodeBackend().validate({ ...PARSED, modelID: "missing" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no model/);
  });

  it("rejects with a reachability hint when opencode cannot be reached", async () => {
    mocks.providerList.mockResolvedValue(err({ message: "connection refused" }));
    const result = await new OpencodeBackend().validate({ ...PARSED, modelID: "zen-vision-model" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Could not reach opencode/);
  });
});

describe("OpencodeBackend.listModels", () => {
  it("unions opencode-reported vision models with the tested-Go set", async () => {
    mocks.providerList.mockResolvedValue(
      ok({
        all: [
          {
            id: "opencode-go",
            models: {
              "glm-5.2": { attachment: false, modalities: { input: ["text"] } },
              "zen-vision": { attachment: true },
            },
          },
          { id: "google", models: { "gemini-2.5-flash": { attachment: true } } },
        ],
      }),
    );
    const models = await new OpencodeBackend().listModels();
    expect(models).toContain("opencode-go/zen-vision");
    expect(models).toContain("opencode-go/kimi-k2.7-code");
    expect(models).not.toContain("opencode-go/glm-5.2");
    expect(models.every((m) => m.startsWith("opencode"))).toBe(true);
  });

  it("falls back to the tested-Go set when opencode is unreachable", async () => {
    mocks.providerList.mockResolvedValue(err({ message: "nope" }));
    const models = await new OpencodeBackend().listModels();
    expect(models).toContain("opencode-go/kimi-k2.7-code");
    expect(models.length).toBeGreaterThanOrEqual(6);
  });
});

describe("OpencodeBackend.analyze", () => {
  it("creates an ephemeral session, prompts with text+file parts, returns assistant text, and deletes the session", async () => {
    mocks.sessionCreate.mockResolvedValue(ok({ id: "sess-1" }));
    mocks.sessionPrompt.mockResolvedValue(
      ok({
        parts: [
          { type: "text", text: "hello" },
          { type: "reasoning", reasoning: "..." },
          { type: "text", text: " there" },
        ],
      }),
    );
    const out = await new OpencodeBackend().analyze(PARSED, IMAGE, "describe");
    expect(out).toBe("hello there");

    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1);
    const promptArg = mocks.sessionPrompt.mock.calls[0][0] as {
      path: { id: string };
      body: { model: { providerID: string; modelID: string }; parts: unknown[] };
    };
    expect(promptArg.path.id).toBe("sess-1");
    expect(promptArg.body.model).toEqual({ providerID: "opencode-go", modelID: "kimi-k2.7-code" });
    expect(promptArg.body.parts).toEqual([
      { type: "text", text: "describe" },
      { type: "file", mime: "image/png", url: "data:image/png;base64,AAAA" },
    ]);
    expect(mocks.sessionDelete).toHaveBeenCalledWith({ path: { id: "sess-1" } });
  });

  it("returns (no response) when the assistant emits no text parts", async () => {
    mocks.sessionCreate.mockResolvedValue(ok({ id: "sess-2" }));
    mocks.sessionPrompt.mockResolvedValue(ok({ parts: [{ type: "reasoning", reasoning: "x" }] }));
    const out = await new OpencodeBackend().analyze(PARSED, IMAGE, "describe");
    expect(out).toBe("(no response)");
    expect(mocks.sessionDelete).toHaveBeenCalledWith({ path: { id: "sess-2" } });
  });

  it("still deletes the session when the prompt call fails", async () => {
    mocks.sessionCreate.mockResolvedValue(ok({ id: "sess-3" }));
    mocks.sessionPrompt.mockResolvedValue(err({ message: "boom" }));
    await expect(new OpencodeBackend().analyze(PARSED, IMAGE, "describe")).rejects.toThrow(
      /opencode backend/,
    );
    expect(mocks.sessionDelete).toHaveBeenCalledWith({ path: { id: "sess-3" } });
  });

  it("throws a reachability error when session creation fails", async () => {
    mocks.sessionCreate.mockResolvedValue(err({ message: "connection refused" }));
    await expect(new OpencodeBackend().analyze(PARSED, IMAGE, "describe")).rejects.toThrow(
      /opencode backend/,
    );
    expect(mocks.sessionDelete).not.toHaveBeenCalled();
  });

  it("honors OPENCODE_BASE_URL in the error message", async () => {
    process.env.OPENCODE_BASE_URL = "http://127.0.0.1:9999";
    mocks.sessionCreate.mockResolvedValue(err({ message: "nope" }));
    await expect(new OpencodeBackend().analyze(PARSED, IMAGE, "describe")).rejects.toThrow(
      /127\.0\.0\.1:9999/,
    );
  });
});
