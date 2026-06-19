import { describe, expect, it, type Mock, vi } from "vitest";
import type { Backend, ValidationResult } from "./backends/types.js";
import type { LoadedImage } from "./image.js";
import type { ParsedModelId } from "./models.js";
import type { ServerDeps } from "./server.js";
import { handleToolCall } from "./server.js";

interface ResultText {
  text: string;
  isError?: boolean;
}

function unwrap(result: {
  content: { type: string; text?: string }[];
  isError?: boolean;
}): ResultText {
  const block = result.content[0];
  return { text: block?.text ?? "", isError: result.isError };
}

function mockBackend(overrides: Partial<Backend> = {}): Backend {
  return {
    name: "google",
    analyze: vi.fn(async () => "mock description"),
    listModels: vi.fn(async () => ["google/gemini-2.5-flash"]),
    validate: vi.fn(async () => ({ valid: true }) as ValidationResult),
    ...overrides,
  };
}

function mockDeps(overrides: Partial<ServerDeps> = {}): ServerDeps & {
  backend: Backend;
  parsed: ParsedModelId;
} {
  const backend = overrides.route ? mockBackend() : mockBackend();
  const parsed: ParsedModelId = {
    providerID: "google",
    modelID: "gemini-2.5-flash",
    backend: "google",
  };
  const base: ServerDeps = {
    route: vi.fn(() => ({ backend, parsed })),
    getConfig: vi.fn(async () => ({ model: "google/gemini-2.5-flash" })),
    setModel: vi.fn(async () => {}),
    loadImage: vi.fn(
      async () =>
        ({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }) as LoadedImage,
    ),
    listAllModels: vi.fn(async () => ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4-5"]),
  };
  return { ...base, ...overrides, backend, parsed };
}

function depsWithBackend(backend: Backend, parsed: ParsedModelId): ServerDeps {
  return {
    route: vi.fn(() => ({ backend, parsed })),
    getConfig: vi.fn(async () => ({ model: "google/gemini-2.5-flash" })),
    setModel: vi.fn(async () => {}),
    loadImage: vi.fn(
      async () =>
        ({ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 }) as LoadedImage,
    ),
    listAllModels: vi.fn(async () => []),
  };
}

describe("handleToolCall — unknown tool", () => {
  it("returns an error result for an unknown tool name", async () => {
    const deps = mockDeps();
    const result = await handleToolCall("bogus", {}, deps);
    expect(result.isError).toBe(true);
    expect(unwrap(result).text).toMatch(/Unknown tool/);
  });
});

describe("handleToolCall — analyze_image", () => {
  it("uses the persisted default model, validates, loads the image, and returns the backend text", async () => {
    const deps = mockDeps();
    const result = await handleToolCall("analyze_image", { image: "/tmp/x.png" }, deps);
    expect(result.isError).toBeUndefined();
    expect(unwrap(result).text).toBe("mock description");
    expect(deps.getConfig).toHaveBeenCalledTimes(1);
    expect(deps.route).toHaveBeenCalledWith("google/gemini-2.5-flash");
    expect(deps.backend.validate).toHaveBeenCalledTimes(1);
    expect(deps.loadImage).toHaveBeenCalledWith("/tmp/x.png");
    expect(deps.backend.analyze).toHaveBeenCalledTimes(1);
  });

  it("uses a per-call model override and skips getConfig", async () => {
    const deps = mockDeps();
    const result = await handleToolCall(
      "analyze_image",
      { image: "/tmp/x.png", model: "anthropic/claude-sonnet-4-5" },
      deps,
    );
    expect(result.isError).toBeUndefined();
    expect(deps.route).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5");
    expect(deps.getConfig).not.toHaveBeenCalled();
  });

  it("uses the default prompt when none is supplied", async () => {
    const deps = mockDeps();
    await handleToolCall("analyze_image", { image: "/tmp/x.png" }, deps);
    const prompt = (deps.backend.analyze as unknown as Mock).mock.calls[0][2] as string;
    expect(prompt).toMatch(/Describe this image in detail/);
  });

  it("uses the supplied prompt when given", async () => {
    const deps = mockDeps();
    await handleToolCall("analyze_image", { image: "/tmp/x.png", prompt: "count the cats" }, deps);
    const prompt = (deps.backend.analyze as unknown as Mock).mock.calls[0][2] as string;
    expect(prompt).toBe("count the cats");
  });

  it("returns an error when the image argument is missing", async () => {
    const deps = mockDeps();
    const result = await handleToolCall("analyze_image", {}, deps);
    expect(result.isError).toBe(true);
    expect(unwrap(result).text).toMatch(/non-empty string/);
  });

  it("returns an error when the model id is malformed", async () => {
    const deps = mockDeps({
      route: vi.fn(() => {
        throw new Error('Malformed model id "nope".');
      }),
    });
    const result = await handleToolCall(
      "analyze_image",
      { image: "/tmp/x.png", model: "nope" },
      deps,
    );
    expect(result.isError).toBe(true);
    expect(unwrap(result).text).toMatch(/Malformed model id/);
  });

  it("returns an error when validation rejects the model", async () => {
    const backend = mockBackend({
      validate: vi.fn(async () => ({ valid: false, reason: "not vision" }) as ValidationResult),
    });
    const deps = depsWithBackend(backend, {
      providerID: "google",
      modelID: "x",
      backend: "google",
    });
    const result = await handleToolCall(
      "analyze_image",
      { image: "/tmp/x.png", model: "google/x" },
      deps,
    );
    expect(result.isError).toBe(true);
    expect(unwrap(result).text).toMatch(/not vision/);
  });

  it("returns an error when image loading fails", async () => {
    const deps = mockDeps({
      loadImage: vi.fn(async () => {
        throw new Error("Not a file: /tmp/x.png");
      }),
    });
    const result = await handleToolCall("analyze_image", { image: "/tmp/x.png" }, deps);
    expect(result.isError).toBe(true);
    expect(unwrap(result).text).toMatch(/Not a file/);
  });

  it("wraps a backend analyze failure as an analyze_image failure", async () => {
    const backend = mockBackend({
      analyze: vi.fn(async () => {
        throw new Error("provider 500");
      }),
    });
    const deps = depsWithBackend(backend, {
      providerID: "google",
      modelID: "gemini-2.5-flash",
      backend: "google",
    });
    const result = await handleToolCall(
      "analyze_image",
      { image: "/tmp/x.png", model: "google/gemini-2.5-flash" },
      deps,
    );
    expect(result.isError).toBe(true);
    expect(unwrap(result).text).toMatch(/analyze_image failed: provider 500/);
  });
});

describe("handleToolCall — set_vision_model", () => {
  it("validates and persists the model, returning a confirmation", async () => {
    const deps = mockDeps();
    const result = await handleToolCall(
      "set_vision_model",
      { model: "google/gemini-2.5-flash" },
      deps,
    );
    expect(result.isError).toBeUndefined();
    expect(unwrap(result).text).toMatch(/set to google\/gemini-2.5-flash/);
    expect(deps.setModel).toHaveBeenCalledWith("google/gemini-2.5-flash");
  });

  it("does not persist when validation fails", async () => {
    const backend = mockBackend({
      validate: vi.fn(async () => ({ valid: false, reason: "nope" }) as ValidationResult),
    });
    const deps = depsWithBackend(backend, {
      providerID: "google",
      modelID: "x",
      backend: "google",
    });
    const result = await handleToolCall("set_vision_model", { model: "google/x" }, deps);
    expect(result.isError).toBe(true);
    expect(deps.setModel).not.toHaveBeenCalled();
  });

  it("returns an error when the model argument is missing", async () => {
    const deps = mockDeps();
    const result = await handleToolCall("set_vision_model", {}, deps);
    expect(result.isError).toBe(true);
    expect(unwrap(result).text).toMatch(/provider\/model/);
  });
});

describe("handleToolCall — get_vision_model", () => {
  it("returns the persisted model id", async () => {
    const deps = mockDeps({
      getConfig: vi.fn(async () => ({ model: "opencode-go/kimi-k2.7-code" })),
    });
    const result = await handleToolCall("get_vision_model", {}, deps);
    expect(result.isError).toBeUndefined();
    expect(unwrap(result).text).toBe("opencode-go/kimi-k2.7-code");
  });
});

describe("handleToolCall — list_vision_models", () => {
  it("returns the aggregated model list, one per line", async () => {
    const deps = mockDeps({
      listAllModels: vi.fn(async () => ["anthropic/claude-sonnet-4-5", "google/gemini-2.5-flash"]),
    });
    const result = await handleToolCall("list_vision_models", {}, deps);
    expect(result.isError).toBeUndefined();
    expect(unwrap(result).text).toBe("anthropic/claude-sonnet-4-5\ngoogle/gemini-2.5-flash");
  });

  it("reports an empty list gracefully", async () => {
    const deps = mockDeps({ listAllModels: vi.fn(async () => []) });
    const result = await handleToolCall("list_vision_models", {}, deps);
    expect(unwrap(result).text).toMatch(/no vision models/);
  });
});
