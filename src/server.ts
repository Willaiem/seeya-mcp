import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { RoutedModel } from "./backends/index.js";
import {
  anthropic as anthropicBackend,
  route as defaultRoute,
  google as googleBackend,
  opencode as opencodeBackend,
} from "./backends/index.js";
import type { ValidationResult } from "./backends/types.js";
import type { SeeyaConfig } from "./config.js";
import { getConfig as defaultGetConfig, setModel as defaultSetModel } from "./config.js";
import { errorMessage, toMcpError } from "./errors.js";
import type { LoadedImage } from "./image.js";
import { loadImage as defaultLoadImage } from "./image.js";
import { DEFAULT_PROMPT, TOOLS } from "./tools.js";

export interface ServerDeps {
  route: (modelId: string) => RoutedModel;
  getConfig: () => Promise<SeeyaConfig>;
  setModel: (id: string) => Promise<void>;
  loadImage: (input: string) => Promise<LoadedImage>;
  listAllModels: () => Promise<string[]>;
}

async function defaultListAllModels(): Promise<string[]> {
  const lists = await Promise.all([
    googleBackend.listModels().catch(() => [] as string[]),
    anthropicBackend.listModels().catch(() => [] as string[]),
    opencodeBackend.listModels().catch(() => [] as string[]),
  ]);
  return Array.from(new Set(lists.flat())).sort();
}

export const defaultDeps: ServerDeps = {
  route: defaultRoute,
  getConfig: defaultGetConfig,
  setModel: defaultSetModel,
  loadImage: defaultLoadImage,
  listAllModels: defaultListAllModels,
};

export function createServer(deps: ServerDeps = defaultDeps): Server {
  const server = new Server(
    { name: "seeya-mcp", version: "0.1.3" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    return handleToolCall(name, args ?? {}, deps);
  });

  return server;
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  deps: ServerDeps = defaultDeps,
): Promise<CallToolResult> {
  switch (name) {
    case "analyze_image":
      return analyzeImage(args, deps);
    case "set_vision_model":
      return setVisionModel(args, deps);
    case "get_vision_model":
      return getVisionModel(deps);
    case "list_vision_models":
      return listVisionModels(deps);
    default:
      return toMcpError(`Unknown tool: ${name}`);
  }
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

async function analyzeImage(
  args: Record<string, unknown>,
  deps: ServerDeps,
): Promise<CallToolResult> {
  const image = args.image;
  if (typeof image !== "string" || !image.trim()) {
    return toMcpError("`image` must be a non-empty string (local file path or http(s) URL).");
  }
  const prompt =
    typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : DEFAULT_PROMPT;

  let modelId: string;
  if (typeof args.model === "string" && args.model.trim()) {
    modelId = args.model.trim();
  } else {
    const config = await deps.getConfig();
    modelId = config.model;
  }

  let routed: RoutedModel;
  try {
    routed = deps.route(modelId);
  } catch (err) {
    return toMcpError(errorMessage(err));
  }

  let validation: ValidationResult;
  try {
    validation = await routed.backend.validate(routed.parsed);
  } catch (err) {
    return toMcpError(errorMessage(err));
  }
  if (!validation.valid) {
    return toMcpError(validation.reason ?? "The selected model is not vision-capable.");
  }

  let loaded: LoadedImage;
  try {
    loaded = await deps.loadImage(image);
  } catch (err) {
    return toMcpError(errorMessage(err));
  }

  try {
    const text = await routed.backend.analyze(routed.parsed, loaded, prompt);
    return textResult(text);
  } catch (err) {
    return toMcpError(`analyze_image failed: ${errorMessage(err)}`);
  }
}

async function setVisionModel(
  args: Record<string, unknown>,
  deps: ServerDeps,
): Promise<CallToolResult> {
  const model = args.model;
  if (typeof model !== "string" || !model.trim()) {
    return toMcpError("`model` must be a non-empty string in provider/model form.");
  }
  let routed: RoutedModel;
  try {
    routed = deps.route(model.trim());
  } catch (err) {
    return toMcpError(errorMessage(err));
  }
  let validation: ValidationResult;
  try {
    validation = await routed.backend.validate(routed.parsed);
  } catch (err) {
    return toMcpError(errorMessage(err));
  }
  if (!validation.valid) {
    return toMcpError(validation.reason ?? "The selected model is not vision-capable.");
  }
  const full = `${routed.parsed.providerID}/${routed.parsed.modelID}`;
  try {
    await deps.setModel(full);
  } catch (err) {
    return toMcpError(`Could not persist vision model: ${errorMessage(err)}`);
  }
  return textResult(`Active vision model set to ${full}.`);
}

async function getVisionModel(deps: ServerDeps): Promise<CallToolResult> {
  const config = await deps.getConfig();
  return textResult(config.model);
}

async function listVisionModels(deps: ServerDeps): Promise<CallToolResult> {
  const models = await deps.listAllModels();
  return textResult(models.length > 0 ? models.join("\n") : "(no vision models available)");
}
