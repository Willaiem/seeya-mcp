import { createServer } from "node:net";
import { createOpencodeServer } from "@opencode-ai/sdk";

// opencode is reachable in one of two ways:
//
//   1. OPENCODE_BASE_URL is set -> talk to that server verbatim (e.g. a manually
//      started `opencode serve`, or a TUI pinned with `{ "server": { "port": N } }`).
//
//   2. Otherwise -> spawn a private `opencode serve` subprocess and reuse it for
//      the lifetime of this process. The SDK reports the URL opencode actually
//      bound, so there is no port guessing. This is what makes the backend work
//      when the user is only running the TUI, which picks a random, undiscoverable
//      port (https://github.com/anomalyco/opencode/issues/9099).

const SERVER_START_TIMEOUT_MS = 15_000;

let serverPromise: Promise<string> | null = null;
let managed: { url: string; close(): void } | null = null;
let cleanupRegistered = false;

/** Base URL of the opencode server this process should talk to. */
export async function resolveOpencodeBaseUrl(): Promise<string> {
  const override = process.env.OPENCODE_BASE_URL?.trim();
  if (override) {
    return override;
  }
  if (!serverPromise) {
    serverPromise = startManagedServer().catch((err) => {
      serverPromise = null; // a later call may succeed (e.g. opencode gets installed)
      throw err;
    });
  }
  return serverPromise;
}

/** True when the URL comes from a managed subprocess rather than OPENCODE_BASE_URL. */
export function usingManagedServer(): boolean {
  return !process.env.OPENCODE_BASE_URL?.trim();
}

async function startManagedServer(): Promise<string> {
  // `opencode serve --port 0` is coerced to the 4096 default rather than picking a
  // free port, so we choose one ourselves. If a TUI already holds it, opencode falls
  // back and reports whatever port it bound; we use the SDK-parsed URL regardless.
  const port = await freePort();
  let server: { url: string; close(): void };
  try {
    server = await createOpencodeServer({
      hostname: "127.0.0.1",
      port,
      timeout: SERVER_START_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(
      "opencode backend: could not start a local opencode server. Is the `opencode` CLI " +
        "installed and on PATH? Set OPENCODE_BASE_URL to use an already-running server instead. " +
        `(${errText(err)})`,
    );
  }
  managed = server;
  registerCleanup();
  return server.url;
}

function registerCleanup(): void {
  if (cleanupRegistered) {
    return;
  }
  cleanupRegistered = true;
  const close = () => {
    try {
      managed?.close();
    } catch {
      // best effort; a leftover serve process is preferable to a crash on shutdown
    }
    managed = null;
  };
  // "exit" is synchronous-only, which is fine: close() just signals the child.
  process.once("exit", close);
  // POSIX hosts terminate stdio MCP servers with SIGTERM/SIGINT; tear the child down
  // and then exit ourselves (the SDK's piped child would otherwise keep us alive).
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      close();
      process.exit(0);
    });
  }
}

/** Ask the OS for a free TCP port to hand to `opencode serve`. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const { port } = address;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error("could not determine a free port")));
      }
    });
  });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
