import type { BackendName, ParsedModelId } from "../models.js";
import { parseModelId } from "../models.js";
import { AnthropicBackend } from "./anthropic.js";
import { GoogleBackend } from "./google.js";
import { OpencodeBackend } from "./opencode.js";
import type { Backend } from "./types.js";

const google = new GoogleBackend();
const anthropic = new AnthropicBackend();
const opencode = new OpencodeBackend();

const backends: Record<BackendName, Backend> = { google, anthropic, opencode };

export interface RoutedModel {
  backend: Backend;
  parsed: ParsedModelId;
}

export function route(modelId: string): RoutedModel {
  const parsed = parseModelId(modelId);
  return { backend: backends[parsed.backend], parsed };
}

export function backendFor(name: BackendName): Backend {
  return backends[name];
}

export type { Backend };
export { anthropic, google, opencode };
