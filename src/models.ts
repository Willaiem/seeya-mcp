export type BackendName = "google" | "anthropic" | "opencode";

export const DEFAULT_MODEL = "google/gemini-2.5-flash";

export const GOOGLE_VISION_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

export const ANTHROPIC_VISION_MODELS = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-1",
  "claude-opus-4-1-20250805",
  "claude-3-7-sonnet-20250219",
  "claude-3-5-sonnet-20241022",
] as const;

export const OPENCODE_GO_VISION_MODELS = [
  "kimi-k2.7-code",
  "kimi-k2.6",
  "mimo-v2.5",
  "qwen3.7-plus",
  "qwen3.6-plus",
  "minimax-m3",
] as const;

export interface ParsedModelId {
  providerID: string;
  modelID: string;
  backend: BackendName;
}

export class ModelIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelIdError";
  }
}

export function backendForProvider(providerID: string): BackendName {
  if (providerID === "google") {
    return "google";
  }
  if (providerID === "anthropic") {
    return "anthropic";
  }
  if (providerID.startsWith("opencode")) {
    return "opencode";
  }
  throw new ModelIdError(
    `Unknown provider prefix "${providerID}". Model ids must use the form provider/model with a known prefix: google, anthropic, or opencode* (e.g. opencode-go).`,
  );
}

export function parseModelId(id: string): ParsedModelId {
  if (typeof id !== "string" || !id.trim()) {
    throw new ModelIdError(
      "Model id is required in the form provider/model (e.g. google/gemini-2.5-flash).",
    );
  }
  const trimmed = id.trim();
  const slashIndex = trimmed.indexOf("/");
  if (
    slashIndex <= 0 ||
    slashIndex === trimmed.length - 1 ||
    trimmed.indexOf("/", slashIndex + 1) !== -1
  ) {
    throw new ModelIdError(
      `Malformed model id "${trimmed}". Use the form provider/model with exactly one "/", e.g. google/gemini-2.5-flash.`,
    );
  }
  const providerID = trimmed.slice(0, slashIndex);
  const modelID = trimmed.slice(slashIndex + 1);
  return { providerID, modelID, backend: backendForProvider(providerID) };
}

export function isVisionModelByAllowlist(id: string): boolean {
  let parsed: ParsedModelId;
  try {
    parsed = parseModelId(id);
  } catch {
    return false;
  }
  return isVisionModelParsed(parsed);
}

export function isVisionModelParsed(parsed: ParsedModelId): boolean {
  switch (parsed.backend) {
    case "google":
      return GOOGLE_VISION_MODELS.includes(parsed.modelID as (typeof GOOGLE_VISION_MODELS)[number]);
    case "anthropic":
      return ANTHROPIC_VISION_MODELS.includes(
        parsed.modelID as (typeof ANTHROPIC_VISION_MODELS)[number],
      );
    case "opencode":
      return OPENCODE_GO_VISION_MODELS.includes(
        parsed.modelID as (typeof OPENCODE_GO_VISION_MODELS)[number],
      );
  }
}

export function listVisionModels(): string[] {
  return [
    ...GOOGLE_VISION_MODELS.map((m) => `google/${m}`),
    ...ANTHROPIC_VISION_MODELS.map((m) => `anthropic/${m}`),
    ...OPENCODE_GO_VISION_MODELS.map((m) => `opencode-go/${m}`),
  ];
}
