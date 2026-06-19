import Anthropic from "@anthropic-ai/sdk";
import type { LoadedImage } from "../image.js";
import { base64FromDataUrl } from "../image.js";
import type { ParsedModelId } from "../models.js";
import { ANTHROPIC_VISION_MODELS } from "../models.js";
import type { Backend, ValidationResult } from "./types.js";

const SUPPORTED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type SupportedMime = (typeof SUPPORTED_MIME_TYPES)[number];

const MAX_OUTPUT_TOKENS = 2048;

export class AnthropicBackend implements Backend {
  readonly name = "anthropic" as const;

  private client: Anthropic | null = null;

  private ensureClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Get one at https://console.anthropic.com, or call set_vision_model with a google/opencode model.",
      );
    }
    if (!this.client) {
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async analyze(model: ParsedModelId, image: LoadedImage, prompt: string): Promise<string> {
    if (!SUPPORTED_MIME_TYPES.includes(image.mimeType as SupportedMime)) {
      throw new Error(`Anthropic supports jpeg/png/gif/webp images; received ${image.mimeType}.`);
    }
    const client = this.ensureClient();
    const message = await client.messages.create({
      model: model.modelID,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mimeType as SupportedMime,
                data: base64FromDataUrl(image.dataUrl),
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    let text = "";
    for (const block of message.content) {
      if (block.type === "text") {
        text += block.text;
      }
    }
    return text || "(no response)";
  }

  async listModels(): Promise<string[]> {
    return ANTHROPIC_VISION_MODELS.map((m) => `anthropic/${m}`);
  }

  async validate(model: ParsedModelId): Promise<ValidationResult> {
    if (
      ANTHROPIC_VISION_MODELS.includes(model.modelID as (typeof ANTHROPIC_VISION_MODELS)[number])
    ) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `Anthropic model "${model.modelID}" is not vision-capable. Call list_vision_models for valid options.`,
    };
  }
}
