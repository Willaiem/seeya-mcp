import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, defaultModel, getConfig, setModel } from "./config.js";

let dir: string;
let cfgPath: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "seeya-cfg-"));
  cfgPath = join(dir, "config.json");
  savedEnv.SEEYA_MCP_CONFIG = process.env.SEEYA_MCP_CONFIG;
  savedEnv.SEEYA_MCP_DEFAULT_MODEL = process.env.SEEYA_MCP_DEFAULT_MODEL;
  process.env.SEEYA_MCP_CONFIG = cfgPath;
  delete process.env.SEEYA_MCP_DEFAULT_MODEL;
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(dir, { recursive: true, force: true });
});

describe("getConfig", () => {
  it("returns DEFAULT_MODEL when no config file and no env override", async () => {
    expect((await getConfig()).model).toBe("google/gemini-2.5-flash");
  });

  it("uses SEEYA_MCP_DEFAULT_MODEL when no config file exists", async () => {
    process.env.SEEYA_MCP_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";
    expect((await getConfig()).model).toBe("anthropic/claude-sonnet-4-5");
  });

  it("reads the model from the config file when present", async () => {
    await writeFile(cfgPath, JSON.stringify({ model: "opencode-go/kimi-k2.7-code" }));
    expect((await getConfig()).model).toBe("opencode-go/kimi-k2.7-code");
  });

  it("falls back to the default when the config file is corrupt", async () => {
    await writeFile(cfgPath, "{ not valid json");
    expect((await getConfig()).model).toBe("google/gemini-2.5-flash");
  });

  it("falls back to the default when the model field is missing or empty", async () => {
    await writeFile(cfgPath, JSON.stringify({}));
    expect((await getConfig()).model).toBe("google/gemini-2.5-flash");
    await writeFile(cfgPath, JSON.stringify({ model: "  " }));
    expect((await getConfig()).model).toBe("google/gemini-2.5-flash");
  });

  it("config file takes precedence over SEEYA_MCP_DEFAULT_MODEL", async () => {
    process.env.SEEYA_MCP_DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";
    await writeFile(cfgPath, JSON.stringify({ model: "google/gemini-2.5-pro" }));
    expect((await getConfig()).model).toBe("google/gemini-2.5-pro");
  });
});

describe("setModel", () => {
  it("writes the model id and creates parent directories", async () => {
    const nested = join(dir, "nested", "deep", "config.json");
    process.env.SEEYA_MCP_CONFIG = nested;
    await setModel("anthropic/claude-sonnet-4-5");
    const raw = JSON.parse(await readFile(nested, "utf8"));
    expect(raw).toEqual({ model: "anthropic/claude-sonnet-4-5" });
  });

  it("rejects an invalid model id", async () => {
    await expect(setModel("nope")).rejects.toThrow();
    await expect(setModel("google/")).rejects.toThrow();
  });
});

describe("configPath / defaultModel", () => {
  it("configPath honors SEEYA_MCP_CONFIG", () => {
    expect(configPath()).toBe(cfgPath);
  });

  it("defaultModel honors SEEYA_MCP_DEFAULT_MODEL", () => {
    process.env.SEEYA_MCP_DEFAULT_MODEL = "opencode-go/kimi-k2.6";
    expect(defaultModel()).toBe("opencode-go/kimi-k2.6");
  });
});
