import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mocks.create };
  },
}));

import { AnthropicBackend } from "./anthropic.js";

const PARSED = {
  providerID: "anthropic",
  modelID: "claude-sonnet-4-6",
  backend: "anthropic",
} as const;
const PNG_IMAGE = { dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 };

beforeEach(() => {
  mocks.create.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("AnthropicBackend.listModels", () => {
  it("returns the anthropic allowlist prefixed with anthropic/", async () => {
    const models = await new AnthropicBackend().listModels();
    expect(models).toContain("anthropic/claude-sonnet-4-6");
    expect(models).toContain("anthropic/claude-fable-5");
    expect(models.every((m) => m.startsWith("anthropic/"))).toBe(true);
  });
});

describe("AnthropicBackend.validate", () => {
  it("accepts an allowlisted model", async () => {
    expect((await new AnthropicBackend().validate(PARSED)).valid).toBe(true);
  });

  it("rejects a non-vision model", async () => {
    const result = await new AnthropicBackend().validate({ ...PARSED, modelID: "claude-2" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not vision-capable/);
  });
});

describe("AnthropicBackend.analyze", () => {
  it("sends an image block and a text block, returns concatenated text only", async () => {
    mocks.create.mockResolvedValue({
      content: [
        { type: "text", text: "hello " },
        { type: "thinking", thinking: "internal" },
        { type: "text", text: "world" },
      ],
    });
    const out = await new AnthropicBackend().analyze(PARSED, PNG_IMAGE, "describe");
    expect(out).toBe("hello world");
    const params = mocks.create.mock.calls[0][0] as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: unknown[] }[];
    };
    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.max_tokens).toBeGreaterThan(0);
    expect(params.messages[0]?.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "text", text: "describe" },
    ]);
  });

  it("returns (no response) when there is no text block", async () => {
    mocks.create.mockResolvedValue({ content: [{ type: "thinking", thinking: "x" }] });
    const out = await new AnthropicBackend().analyze(PARSED, PNG_IMAGE, "describe");
    expect(out).toBe("(no response)");
  });

  it("rejects an unsupported mime type (bmp)", async () => {
    await expect(
      new AnthropicBackend().analyze(
        PARSED,
        { dataUrl: "data:image/bmp;base64,AAAA", mimeType: "image/bmp", bytes: 3 },
        "describe",
      ),
    ).rejects.toThrow(/jpeg\/png\/gif\/webp/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("throws a clear error when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(new AnthropicBackend().analyze(PARSED, PNG_IMAGE, "describe")).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});
