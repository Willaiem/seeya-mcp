import type { LoadedImage } from "../image.js";
import type { BackendName, ParsedModelId } from "../models.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface Backend {
  readonly name: BackendName;
  analyze(model: ParsedModelId, image: LoadedImage, prompt: string): Promise<string>;
  listModels(): Promise<string[]>;
  validate(model: ParsedModelId): Promise<ValidationResult>;
}

export type { ParsedModelId };
