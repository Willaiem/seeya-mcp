import { GoogleGenAI } from "@google/genai";
import type { LoadedImage } from "../image.js";
import { base64FromDataUrl } from "../image.js";
import type { ParsedModelId } from "../models.js";
import { GOOGLE_VISION_MODELS } from "../models.js";
import type { Backend, ValidationResult } from "./types.js";

export class GoogleBackend implements Backend {
  readonly name = "google" as const;

  private client: GoogleGenAI | null = null;

  private ensureClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error(
        "GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey, or call set_vision_model with an opencode/anthropic model.",
      );
    }
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  async analyze(model: ParsedModelId, image: LoadedImage, prompt: string): Promise<string> {
    const ai = this.ensureClient();
    const result = await ai.models.generateContent({
      model: model.modelID,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { data: base64FromDataUrl(image.dataUrl), mimeType: image.mimeType } },
          ],
        },
      ],
    });
    return result.text || "(no response)";
  }

  async listModels(): Promise<string[]> {
    return GOOGLE_VISION_MODELS.map((m) => `google/${m}`);
  }

  async validate(model: ParsedModelId): Promise<ValidationResult> {
    if (GOOGLE_VISION_MODELS.includes(model.modelID as (typeof GOOGLE_VISION_MODELS)[number])) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `Google model "${model.modelID}" is not vision-capable. Call list_vision_models for valid options.`,
    };
  }
}
