import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_PROMPT_DESCRIPTION =
  "Describe this image in detail. Note any text, UI elements, layout, colors, and notable objects.";

export const DEFAULT_PROMPT = DEFAULT_PROMPT_DESCRIPTION;

export const TOOLS: Tool[] = [
  {
    name: "analyze_image",
    description:
      "Analyze an image using a vision-capable model. Pass a local file path or an http(s) URL, plus an optional prompt/question. Returns the model's textual description or answer. Use this when the calling agent lacks vision and needs to understand an image (screenshots, diagrams, UI mockups, photos). The active vision model is used unless a `model` (provider/model) override is supplied for this call only.",
    inputSchema: {
      type: "object",
      properties: {
        image: {
          type: "string",
          description: "Local file path or http(s) URL of the image to analyze.",
        },
        prompt: {
          type: "string",
          description: `Question or instruction for the vision model. Defaults to: "${DEFAULT_PROMPT_DESCRIPTION}".`,
        },
        model: {
          type: "string",
          description:
            "Optional provider/model id (e.g. google/gemini-2.5-flash) that overrides the persisted default for this call only.",
        },
      },
      required: ["image"],
      additionalProperties: false,
    },
  },
  {
    name: "set_vision_model",
    description:
      "Set and persist the active vision model used by analyze_image. The id uses the provider/model form (e.g. google/gemini-2.5-flash, anthropic/claude-sonnet-4-5, opencode-go/kimi-k2.7-code). The choice persists across opencode restarts.",
    inputSchema: {
      type: "object",
      properties: {
        model: {
          type: "string",
          description: "Vision model id in provider/model form.",
        },
      },
      required: ["model"],
      additionalProperties: false,
    },
  },
  {
    name: "get_vision_model",
    description: "Return the currently active vision model id (provider/model).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_vision_models",
    description:
      "List the vision-capable models available across all backends (Google, Anthropic, opencode). Returns one provider/model id per line.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];
