import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));

import { GoogleBackend } from "./google.js";

const PARSED = { providerID: "google", modelID: "gemini-2.5-flash", backend: "google" } as const;
const IMAGE = { dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 };

beforeEach(() => {
  mocks.generateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe("GoogleBackend.listModels", () => {
  it("returns the google allowlist prefixed with google/", async () => {
    const models = await new GoogleBackend().listModels();
    expect(models).toContain("google/gemini-2.5-flash");
    expect(models.every((m) => m.startsWith("google/"))).toBe(true);
  });
});

describe("GoogleBackend.validate", () => {
  it("accepts an allowlisted model", async () => {
    expect((await new GoogleBackend().validate(PARSED)).valid).toBe(true);
  });

  it("rejects a non-vision model with a helpful reason", async () => {
    const result = await new GoogleBackend().validate({ ...PARSED, modelID: "gemini-1.0" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not vision-capable/);
  });
});

describe("GoogleBackend.analyze", () => {
  it("calls generateContent with the model id and inline image data, returns text", async () => {
    mocks.generateContent.mockResolvedValue({ text: "a green box" });
    const out = await new GoogleBackend().analyze(PARSED, IMAGE, "describe");
    expect(out).toBe("a green box");
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
    const call = mocks.generateContent.mock.calls[0][0] as {
      model: string;
      contents: { role: string; parts: unknown[] }[];
    };
    expect(call.model).toBe("gemini-2.5-flash");
    expect(call.contents[0]?.parts).toEqual([
      { text: "describe" },
      { inlineData: { data: "AAAA", mimeType: "image/png" } },
    ]);
  });

  it("returns (no response) when the model returns no text", async () => {
    mocks.generateContent.mockResolvedValue({ text: "" });
    const out = await new GoogleBackend().analyze(PARSED, IMAGE, "describe");
    expect(out).toBe("(no response)");
  });

  it("throws a clear error when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(new GoogleBackend().analyze(PARSED, IMAGE, "describe")).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it("does not require a key for listModels or validate", async () => {
    delete process.env.GEMINI_API_KEY;
    const backend = new GoogleBackend();
    await expect(backend.listModels()).resolves.toBeDefined();
    await expect(backend.validate(PARSED)).resolves.toEqual({ valid: true });
  });
});
