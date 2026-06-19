import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { errorMessage } from "./errors.js";
import { DEFAULT_MODEL, parseModelId } from "./models.js";

export interface SeeyaConfig {
  model: string;
}

export function configPath(): string {
  return process.env.SEEYA_MCP_CONFIG ?? join(homedir(), ".seeya-mcp", "config.json");
}

export function defaultModel(): string {
  return process.env.SEEYA_MCP_DEFAULT_MODEL ?? DEFAULT_MODEL;
}

export async function getConfig(): Promise<SeeyaConfig> {
  const path = configPath();
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as { model?: unknown };
    if (typeof data.model === "string" && data.model.trim()) {
      return { model: data.model.trim() };
    }
  } catch (err) {
    if (!isNotFoundError(err)) {
      console.error(`[seeya-mcp] warning: could not read config ${path}: ${errorMessage(err)}`);
    }
  }
  return { model: defaultModel() };
}

export async function setModel(id: string): Promise<void> {
  const parsed = parseModelId(id);
  const full = `${parsed.providerID}/${parsed.modelID}`;
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ model: full }, null, 2)}\n`, "utf8");
}

function isNotFoundError(err: unknown): boolean {
  if (err == null || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENODATA";
}
