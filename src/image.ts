import { Buffer } from "node:buffer";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";

export interface LoadedImage {
  dataUrl: string;
  mimeType: string;
  bytes: number;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXT = new Map<string, string>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
]);

export function maxBytes(): number {
  const raw = process.env.SEEYA_MCP_MAX_BYTES;
  if (raw == null || raw.trim() === "") {
    return DEFAULT_MAX_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_BYTES;
  }
  return parsed;
}

export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

function mimeFromExtension(path: string): string | undefined {
  return MIME_BY_EXT.get(extname(path).toLowerCase());
}

function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

function toDataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}

export async function loadImage(input: string): Promise<LoadedImage> {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("`image` must be a non-empty string (local file path or http(s) URL).");
  }

  if (isHttpUrl(input)) {
    return loadFromUrl(input);
  }
  return loadFromFile(input);
}

async function loadFromUrl(input: string): Promise<LoadedImage> {
  let res: Response;
  try {
    res = await fetch(input, { redirect: "follow" });
  } catch (err) {
    throw new Error(`Failed to fetch image from ${input}: ${errMessage(err)}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch image: HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const headerMime = contentType.split(";")[0]?.trim() ?? "";
  const mimeType = headerMime.startsWith("image/")
    ? headerMime
    : mimeFromExtension(new URL(input).pathname);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes()) {
    throw new Error(`Image too large: ${buf.byteLength} bytes (max ${maxBytes()}).`);
  }
  if (!mimeType?.startsWith("image/")) {
    throw new Error(`URL did not return an image (content-type: ${contentType}).`);
  }
  return {
    dataUrl: toDataUrl(buf.toString("base64"), mimeType),
    mimeType,
    bytes: buf.byteLength,
  };
}

async function loadFromFile(input: string): Promise<LoadedImage> {
  const path = isAbsolute(input) ? input : resolve(process.cwd(), input);
  const info = await stat(path);
  if (!info.isFile()) {
    throw new Error(`Not a file: ${path}`);
  }
  if (info.size > maxBytes()) {
    throw new Error(`Image too large: ${info.size} bytes (max ${maxBytes()}).`);
  }
  const buf = await readFile(path);
  const mimeType = mimeFromExtension(path) ?? "image/jpeg";
  return {
    dataUrl: toDataUrl(buf.toString("base64"), mimeType),
    mimeType,
    bytes: buf.byteLength,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
