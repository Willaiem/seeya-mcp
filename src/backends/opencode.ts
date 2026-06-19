import {
  createOpencodeClient,
  type FilePartInput,
  type OpencodeClient,
  type Part,
  type TextPart,
  type TextPartInput,
} from "@opencode-ai/sdk";
import type { LoadedImage } from "../image.js";
import type { ParsedModelId } from "../models.js";
import { OPENCODE_GO_VISION_MODELS } from "../models.js";
import { resolveOpencodeBaseUrl, usingManagedServer } from "./opencode-server.js";
import type { Backend, ValidationResult } from "./types.js";

interface ProviderListModel {
  attachment?: boolean;
  modalities?: { input?: string[] };
}

type ProviderListEntry = {
  id: string;
  models?: Record<string, ProviderListModel>;
};

interface ProviderListData {
  all?: ProviderListEntry[];
}

export class OpencodeBackend implements Backend {
  readonly name = "opencode" as const;

  private async connect(): Promise<{ client: OpencodeClient; baseUrl: string }> {
    const baseUrl = await resolveOpencodeBaseUrl();
    return { client: createOpencodeClient({ baseUrl }), baseUrl };
  }

  async analyze(model: ParsedModelId, image: LoadedImage, prompt: string): Promise<string> {
    const { client, baseUrl } = await this.connect();
    const created = await this.call(baseUrl, () => client.session.create());
    const sessionId = created?.id;
    if (!sessionId) {
      throw new Error(`opencode backend: could not create a session. ${reachHint(baseUrl)}`);
    }
    try {
      const parts: Array<TextPartInput | FilePartInput> = [
        { type: "text", text: prompt },
        { type: "file", mime: image.mimeType, url: image.dataUrl },
      ];
      const result = await this.call(baseUrl, () =>
        client.session.prompt({
          path: { id: sessionId },
          body: {
            model: { providerID: model.providerID, modelID: model.modelID },
            parts,
          },
        }),
      );
      const text = (result?.parts ?? [])
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("");
      return text || "(no response)";
    } finally {
      try {
        await client.session.delete({ path: { id: sessionId } });
      } catch {
        // Best-effort cleanup: a leftover empty session is acceptable.
      }
    }
  }

  async listModels(): Promise<string[]> {
    const data = await this.safeProviderList();
    const ids = new Set<string>();
    if (data) {
      for (const provider of data.all ?? []) {
        if (!provider.id.startsWith("opencode")) {
          continue;
        }
        for (const [modelId, m] of Object.entries(provider.models ?? {})) {
          if (this.isVisionCapable(modelId, m)) {
            ids.add(`${provider.id}/${modelId}`);
          }
        }
      }
    }
    for (const m of OPENCODE_GO_VISION_MODELS) {
      ids.add(`opencode-go/${m}`);
    }
    return Array.from(ids);
  }

  async validate(model: ParsedModelId): Promise<ValidationResult> {
    if (
      OPENCODE_GO_VISION_MODELS.includes(
        model.modelID as (typeof OPENCODE_GO_VISION_MODELS)[number],
      )
    ) {
      return { valid: true };
    }
    const data = await this.safeProviderList();
    if (!data) {
      return {
        valid: false,
        reason: `Could not reach opencode to validate "${model.providerID}/${model.modelID}". ${unreachableDetail()}`,
      };
    }
    const provider = (data.all ?? []).find((p) => p.id === model.providerID);
    if (!provider) {
      return {
        valid: false,
        reason: `opencode provider "${model.providerID}" was not found. Call list_vision_models for valid options.`,
      };
    }
    const entry = provider.models?.[model.modelID];
    if (!entry) {
      return {
        valid: false,
        reason: `opencode has no model "${model.modelID}" under provider "${model.providerID}". Call list_vision_models for valid options.`,
      };
    }
    if (this.isVisionCapable(model.modelID, entry)) {
      return { valid: true };
    }
    return {
      valid: false,
      reason: `opencode model "${model.providerID}/${model.modelID}" is not vision-capable. Call list_vision_models for valid options.`,
    };
  }

  private isVisionCapable(modelId: string, m: ProviderListModel): boolean {
    return (
      OPENCODE_GO_VISION_MODELS.includes(modelId as (typeof OPENCODE_GO_VISION_MODELS)[number]) ||
      m.attachment === true ||
      (m.modalities?.input?.includes("image") ?? false)
    );
  }

  private async safeProviderList(): Promise<ProviderListData | null> {
    try {
      const { client } = await this.connect();
      const res = await client.provider.list();
      if (res.error || !res.data) {
        return null;
      }
      return res.data as unknown as ProviderListData;
    } catch {
      return null;
    }
  }

  private async call<T>(
    baseUrl: string,
    fn: () => Promise<{ data: T | undefined; error: unknown }>,
  ): Promise<T> {
    try {
      const res = await fn();
      if (res.error || res.data === undefined) {
        throw new Error(
          `opencode backend call failed at ${baseUrl}: ${JSON.stringify(res.error) ?? "no data"}`,
        );
      }
      return res.data;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("opencode backend call failed")) {
        throw err;
      }
      throw new Error(`opencode backend: ${reachHint(baseUrl)} (${errText(err)})`);
    }
  }
}

function reachHint(baseUrl: string): string {
  return usingManagedServer()
    ? `Could not reach the managed opencode server at ${baseUrl} (started via the \`opencode\` CLI).`
    : `Could not reach opencode at ${baseUrl}. Is opencode running? Set OPENCODE_BASE_URL if it is on another port.`;
}

function unreachableDetail(): string {
  return usingManagedServer()
    ? "Could not start a local opencode server; ensure the `opencode` CLI is installed and on PATH, or set OPENCODE_BASE_URL to point at a running server."
    : "Is opencode running at OPENCODE_BASE_URL?";
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { Part };
