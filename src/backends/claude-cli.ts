import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedImage } from "../image.js";
import { base64FromDataUrl } from "../image.js";
import type { ParsedModelId } from "../models.js";

// When ANTHROPIC_API_KEY is absent, the Anthropic backend falls back to the
// locally installed Claude Code CLI (`claude -p`). That lets consumers reuse
// their Claude Code subscription (OAuth) instead of providing an API key.
//
// The CLI cannot take an inline base64 image (it strips them), so we write the
// already-loaded image to a throwaway temp dir, run the CLI there, and let its
// Read tool load the file. stdin carries the prompt so nothing user-supplied
// ever reaches the command line.

const CLAUDE_CLI_TIMEOUT_MS = 120_000;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

interface ClaudeCliResult {
  type?: string;
  is_error?: boolean;
  result?: string;
}

export async function analyzeWithClaudeCli(
  model: ParsedModelId,
  image: LoadedImage,
  prompt: string,
): Promise<string> {
  const ext = EXT_BY_MIME[image.mimeType] ?? "png";
  const dir = await mkdtemp(join(tmpdir(), "seeya-claude-"));
  const file = join(dir, `image.${ext}`);
  await writeFile(file, Buffer.from(base64FromDataUrl(image.dataUrl), "base64"));
  try {
    const out = await runClaude(model.modelID, dir, buildPrompt(file, prompt));
    return out || "(no response)";
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {
      // Best-effort cleanup of the throwaway image dir.
    });
  }
}

function buildPrompt(imagePath: string, prompt: string): string {
  return [
    `Read the image file at ${imagePath} using the Read tool, then respond to the request below about that image.`,
    "Output only your answer, with no preamble, commentary, or follow-up questions.",
    "",
    prompt,
  ].join("\n");
}

function runClaude(modelID: string, cwd: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", "--model", modelID, "--allowedTools", "Read", "--output-format", "json"],
      // `shell` resolves the `claude.cmd`/`claude.ps1` shim npm installs on Windows;
      // the prompt travels over stdin, so the command line stays free of user input.
      { cwd, shell: process.platform === "win32", stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill();
      finish(() =>
        reject(new Error(`Claude Code CLI timed out after ${CLAUDE_CLI_TIMEOUT_MS / 1000}s.`)),
      );
    }, CLAUDE_CLI_TIMEOUT_MS);

    function finish(action: () => void): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      finish(() => reject(claudeSpawnError(err)));
    });

    child.on("close", (code) => {
      finish(() => {
        try {
          resolve(parseResult(stdout, stderr, code));
        } catch (err) {
          reject(err);
        }
      });
    });

    child.stdin.on("error", () => {
      // Ignore EPIPE if the CLI exits before consuming the prompt; the close
      // handler reports the real failure.
    });
    child.stdin.end(prompt);
  });
}

function parseResult(stdout: string, stderr: string, code: number | null): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    const detail = stderr.trim() || `exit code ${code}`;
    throw new Error(`Claude Code CLI produced no output (${detail}).`);
  }
  let parsed: ClaudeCliResult;
  try {
    parsed = JSON.parse(trimmed) as ClaudeCliResult;
  } catch {
    throw new Error(`Could not parse Claude Code CLI output: ${trimmed.slice(0, 300)}`);
  }
  if (parsed.is_error || code !== 0) {
    throw new Error(`Claude Code CLI failed: ${parsed.result ?? stderr.trim() ?? "unknown error"}`);
  }
  return typeof parsed.result === "string" ? parsed.result : "";
}

function claudeSpawnError(err: unknown): Error {
  if (err && typeof err === "object" && (err as { code?: string }).code === "ENOENT") {
    return new Error(
      "ANTHROPIC_API_KEY is not set and the Claude Code CLI (`claude`) was not found on PATH. " +
        "Install Claude Code (npm i -g @anthropic-ai/claude-code) and sign in, or set ANTHROPIC_API_KEY.",
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`Could not run the Claude Code CLI: ${message}`);
}
