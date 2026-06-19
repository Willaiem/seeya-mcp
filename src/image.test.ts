import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64FromDataUrl, loadImage, maxBytes } from "./image.js";

let dir: string;
let savedMax: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "seeya-img-"));
  savedMax = process.env.SEEYA_MCP_MAX_BYTES;
  delete process.env.SEEYA_MCP_MAX_BYTES;
});

afterEach(async () => {
  if (savedMax === undefined) {
    delete process.env.SEEYA_MCP_MAX_BYTES;
  } else {
    process.env.SEEYA_MCP_MAX_BYTES = savedMax;
  }
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

function fakeResponse(
  body: Buffer,
  init: { ok?: boolean; status?: number; statusText?: string; contentType?: string } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: new Headers(init.contentType ? { "content-type": init.contentType } : {}),
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  } as unknown as Response;
}

describe("loadImage (local file)", () => {
  it("loads a png and builds a data url with the right mime", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const path = join(dir, "x.png");
    await writeFile(path, bytes);
    const img = await loadImage(path);
    expect(img.mimeType).toBe("image/png");
    expect(img.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(img.bytes).toBe(4);
    expect(base64FromDataUrl(img.dataUrl)).toBe(bytes.toString("base64"));
  });

  it("defaults unknown extensions to image/jpeg", async () => {
    const path = join(dir, "x.dat");
    await writeFile(path, Buffer.from("hi"));
    const img = await loadImage(path);
    expect(img.mimeType).toBe("image/jpeg");
  });

  it("rejects a non-existent file", async () => {
    await expect(loadImage(join(dir, "missing.png"))).rejects.toThrow();
  });

  it("rejects a path that is a directory", async () => {
    await expect(loadImage(dir)).rejects.toThrow(/Not a file/);
  });

  it("rejects files over the size limit", async () => {
    process.env.SEEYA_MCP_MAX_BYTES = "3";
    const path = join(dir, "big.png");
    await writeFile(path, Buffer.alloc(10, 1));
    await expect(loadImage(path)).rejects.toThrow(/too large/);
  });

  it("honors a custom SEEYA_MCP_MAX_BYTES that fits", async () => {
    process.env.SEEYA_MCP_MAX_BYTES = "1000";
    const path = join(dir, "ok.png");
    await writeFile(path, Buffer.alloc(10, 1));
    const img = await loadImage(path);
    expect(img.bytes).toBe(10);
  });
});

describe("loadImage (http url)", () => {
  it("fetches an image url and sniffs mime from content-type", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const fetchMock = vi.fn(async () => fakeResponse(bytes, { contentType: "image/png" }));
    vi.stubGlobal("fetch", fetchMock);
    const img = await loadImage("https://example.com/a.png");
    expect(img.mimeType).toBe("image/png");
    expect(img.bytes).toBe(4);
    expect(img.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/a.png", { redirect: "follow" });
  });

  it("falls back to the extension mime when content-type is not an image", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(Buffer.from([1, 2, 3]), { contentType: "application/octet-stream" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const img = await loadImage("https://example.com/a.gif");
    expect(img.mimeType).toBe("image/gif");
  });

  it("rejects a non-ok response", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(Buffer.alloc(0), { ok: false, status: 404, statusText: "Not Found" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadImage("https://example.com/missing.png")).rejects.toThrow(/HTTP 404/);
  });

  it("rejects when content-type is not image and there is no image extension", async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(Buffer.from([1]), { contentType: "text/html" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadImage("https://example.com/page")).rejects.toThrow(/did not return an image/);
  });

  it("rejects oversized urls", async () => {
    process.env.SEEYA_MCP_MAX_BYTES = "2";
    const fetchMock = vi.fn(async () =>
      fakeResponse(Buffer.from([1, 2, 3, 4]), { contentType: "image/png" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadImage("https://example.com/big.png")).rejects.toThrow(/too large/);
  });
});

describe("loadImage (input validation)", () => {
  it("rejects an empty input", async () => {
    await expect(loadImage("")).rejects.toThrow(/non-empty string/);
  });
});

describe("maxBytes", () => {
  it("defaults to 20 MB", () => {
    expect(maxBytes()).toBe(20 * 1024 * 1024);
  });
});
