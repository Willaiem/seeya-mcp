import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
  rm: mocks.rm,
}));

import { analyzeWithClaudeCli } from "./claude-cli.js";

const PARSED = {
  providerID: "anthropic",
  modelID: "claude-sonnet-4-6",
  backend: "anthropic",
} as const;
const PNG_IMAGE = { dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png", bytes: 3 };

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn(), on: vi.fn() };
  child.kill = vi.fn();
  return child;
}

/** Resolve the child the next spawn() call returns, returning it for driving. */
function nextChild(): FakeChild {
  const child = fakeChild();
  mocks.spawn.mockReturnValueOnce(child);
  return child;
}

beforeEach(() => {
  mocks.spawn.mockReset();
  mocks.mkdtemp.mockReset().mockResolvedValue("/tmp/seeya-claude-xyz");
  mocks.writeFile.mockReset().mockResolvedValue(undefined);
  mocks.rm.mockReset().mockResolvedValue(undefined);
});

describe("analyzeWithClaudeCli", () => {
  it("writes the image, runs claude -p, and returns the parsed result", async () => {
    const child = nextChild();
    const promise = analyzeWithClaudeCli(PARSED, PNG_IMAGE, "describe");

    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.stdout.emit("data", JSON.stringify({ type: "result", is_error: false, result: "a cat" }));
    child.emit("close", 0);

    expect(await promise).toBe("a cat");

    // image written to the temp dir as base64 bytes
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    const [writtenPath, written] = mocks.writeFile.mock.calls[0];
    expect(String(writtenPath)).toContain("image.png");
    expect((written as Buffer).toString("base64")).toBe("AAAA");

    // spawn invocation: model passed through, Read allowed, json output, cwd = temp dir
    const [cmd, args, opts] = mocks.spawn.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toEqual([
      "-p",
      "--model",
      "claude-sonnet-4-6",
      "--allowedTools",
      "Read",
      "--output-format",
      "json",
    ]);
    expect(opts.cwd).toBe("/tmp/seeya-claude-xyz");

    // prompt goes over stdin, not the command line
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(String(child.stdin.end.mock.calls[0][0])).toContain("describe");

    // temp dir cleaned up
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/seeya-claude-xyz", {
      recursive: true,
      force: true,
    });
  });

  it("returns (no response) when the CLI result is empty", async () => {
    const child = nextChild();
    const promise = analyzeWithClaudeCli(PARSED, PNG_IMAGE, "describe");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.stdout.emit("data", JSON.stringify({ type: "result", is_error: false, result: "" }));
    child.emit("close", 0);
    expect(await promise).toBe("(no response)");
  });

  it("rejects with a helpful message when claude is not installed", async () => {
    const child = nextChild();
    const promise = analyzeWithClaudeCli(PARSED, PNG_IMAGE, "describe");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.emit("error", Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }));
    await expect(promise).rejects.toThrow(/Claude Code CLI.*not found|npm i -g/);
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("rejects when the CLI reports is_error", async () => {
    const child = nextChild();
    const promise = analyzeWithClaudeCli(PARSED, PNG_IMAGE, "describe");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.stdout.emit("data", JSON.stringify({ is_error: true, result: "model exploded" }));
    child.emit("close", 1);
    await expect(promise).rejects.toThrow(/model exploded/);
  });

  it("rejects on non-zero exit with no parseable output", async () => {
    const child = nextChild();
    const promise = analyzeWithClaudeCli(PARSED, PNG_IMAGE, "describe");
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
    child.stderr.emit("data", "boom");
    child.emit("close", 1);
    await expect(promise).rejects.toThrow(/boom|no output/);
  });
});
