import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function toMcpError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
