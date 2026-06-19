import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_VISION_MODELS,
  backendForProvider,
  DEFAULT_MODEL,
  GOOGLE_VISION_MODELS,
  isVisionModelByAllowlist,
  listVisionModels,
  ModelIdError,
  OPENCODE_GO_VISION_MODELS,
  parseModelId,
} from "./models.js";

describe("backendForProvider", () => {
  it("routes known prefixes to a backend", () => {
    expect(backendForProvider("google")).toBe("google");
    expect(backendForProvider("anthropic")).toBe("anthropic");
    expect(backendForProvider("opencode")).toBe("opencode");
    expect(backendForProvider("opencode-go")).toBe("opencode");
  });

  it("throws ModelIdError on an unknown prefix", () => {
    expect(() => backendForProvider("foo")).toThrow(ModelIdError);
    expect(() => backendForProvider("openai")).toThrow(/Unknown provider prefix/);
  });
});

describe("parseModelId", () => {
  it.each([
    [
      "google/gemini-2.5-flash",
      { providerID: "google", modelID: "gemini-2.5-flash", backend: "google" },
    ],
    [
      "anthropic/claude-sonnet-4-5",
      { providerID: "anthropic", modelID: "claude-sonnet-4-5", backend: "anthropic" },
    ],
    [
      "opencode-go/kimi-k2.7-code",
      { providerID: "opencode-go", modelID: "kimi-k2.7-code", backend: "opencode" },
    ],
    [
      "opencode/some-zen-model",
      { providerID: "opencode", modelID: "some-zen-model", backend: "opencode" },
    ],
  ])("parses %s", (id, expected) => {
    expect(parseModelId(id)).toEqual(expected);
  });

  it.each([
    "",
    "  ",
    "nogemini",
    "google/",
    "/flash",
    "google/a/b",
    "google//flash",
    "   /   ",
  ])("rejects malformed id %j", (id) => {
    expect(() => parseModelId(id)).toThrow(ModelIdError);
  });

  it("trims surrounding whitespace", () => {
    expect(parseModelId("  google/gemini-2.5-flash  ")).toEqual({
      providerID: "google",
      modelID: "gemini-2.5-flash",
      backend: "google",
    });
  });
});

describe("isVisionModelByAllowlist", () => {
  it("accepts allowlisted models", () => {
    expect(isVisionModelByAllowlist("google/gemini-2.5-flash")).toBe(true);
    expect(isVisionModelByAllowlist("anthropic/claude-sonnet-4-5")).toBe(true);
    expect(isVisionModelByAllowlist("opencode-go/kimi-k2.7-code")).toBe(true);
  });

  it("rejects non-allowlisted models", () => {
    expect(isVisionModelByAllowlist("google/gemini-1.0")).toBe(false);
    expect(isVisionModelByAllowlist("anthropic/claude-3-haiku-20240307")).toBe(false);
    expect(isVisionModelByAllowlist("opencode-go/glm-5.2")).toBe(false);
  });

  it("rejects malformed ids without throwing", () => {
    expect(isVisionModelByAllowlist("nope")).toBe(false);
    expect(isVisionModelByAllowlist("")).toBe(false);
  });
});

describe("listVisionModels", () => {
  it("returns the union of google, anthropic, and opencode-go tested sets", () => {
    const all = listVisionModels();
    expect(all).toContain("google/gemini-2.5-flash");
    expect(all).toContain("anthropic/claude-sonnet-4-5");
    expect(all).toContain("opencode-go/kimi-k2.7-code");
    expect(all).toHaveLength(
      GOOGLE_VISION_MODELS.length +
        ANTHROPIC_VISION_MODELS.length +
        OPENCODE_GO_VISION_MODELS.length,
    );
  });
});

describe("DEFAULT_MODEL", () => {
  it("is google/gemini-2.5-flash so a fresh install behaves like the old server", () => {
    expect(DEFAULT_MODEL).toBe("google/gemini-2.5-flash");
  });
});
