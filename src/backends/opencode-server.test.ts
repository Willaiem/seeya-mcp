import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createOpencodeServer: vi.fn() }));

vi.mock("@opencode-ai/sdk", () => ({
  createOpencodeServer: mocks.createOpencodeServer,
}));

// Each test gets a fresh module so the process-lifetime server cache is reset.
async function freshModule() {
  vi.resetModules();
  return import("./opencode-server.js");
}

beforeEach(() => {
  mocks.createOpencodeServer.mockReset();
  delete process.env.OPENCODE_BASE_URL;
});

afterEach(() => {
  delete process.env.OPENCODE_BASE_URL;
});

describe("resolveOpencodeBaseUrl", () => {
  it("returns OPENCODE_BASE_URL verbatim without spawning a server", async () => {
    process.env.OPENCODE_BASE_URL = "http://127.0.0.1:9999";
    const { resolveOpencodeBaseUrl, usingManagedServer } = await freshModule();

    expect(await resolveOpencodeBaseUrl()).toBe("http://127.0.0.1:9999");
    expect(mocks.createOpencodeServer).not.toHaveBeenCalled();
    expect(usingManagedServer()).toBe(false);
  });

  it("trims whitespace around OPENCODE_BASE_URL", async () => {
    process.env.OPENCODE_BASE_URL = "  http://127.0.0.1:9999  ";
    const { resolveOpencodeBaseUrl } = await freshModule();
    expect(await resolveOpencodeBaseUrl()).toBe("http://127.0.0.1:9999");
  });

  it("spawns a managed server on a free port and returns its reported url", async () => {
    mocks.createOpencodeServer.mockResolvedValue({
      url: "http://127.0.0.1:54321",
      close: vi.fn(),
    });
    const { resolveOpencodeBaseUrl, usingManagedServer } = await freshModule();

    expect(await resolveOpencodeBaseUrl()).toBe("http://127.0.0.1:54321");
    expect(usingManagedServer()).toBe(true);
    expect(mocks.createOpencodeServer).toHaveBeenCalledTimes(1);
    const opts = mocks.createOpencodeServer.mock.calls[0][0];
    expect(opts.hostname).toBe("127.0.0.1");
    expect(typeof opts.port).toBe("number");
    expect(opts.port).toBeGreaterThan(0);
  });

  it("spawns the managed server only once and reuses it", async () => {
    mocks.createOpencodeServer.mockResolvedValue({
      url: "http://127.0.0.1:54321",
      close: vi.fn(),
    });
    const { resolveOpencodeBaseUrl } = await freshModule();

    const [a, b] = await Promise.all([resolveOpencodeBaseUrl(), resolveOpencodeBaseUrl()]);
    expect(a).toBe("http://127.0.0.1:54321");
    expect(b).toBe("http://127.0.0.1:54321");
    expect(mocks.createOpencodeServer).toHaveBeenCalledTimes(1);
  });

  it("wraps spawn failure with an install/PATH hint and allows a later retry", async () => {
    mocks.createOpencodeServer.mockRejectedValue(new Error("spawn opencode ENOENT"));
    const { resolveOpencodeBaseUrl } = await freshModule();

    await expect(resolveOpencodeBaseUrl()).rejects.toThrow(
      /could not start a local opencode server/,
    );
    await expect(resolveOpencodeBaseUrl()).rejects.toThrow(/installed and on PATH/);

    // The failed attempt must not be cached: a later call retries the spawn.
    mocks.createOpencodeServer.mockResolvedValueOnce({
      url: "http://127.0.0.1:40000",
      close: vi.fn(),
    });
    expect(await resolveOpencodeBaseUrl()).toBe("http://127.0.0.1:40000");
  });
});
