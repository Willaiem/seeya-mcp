#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, isAbsolute } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from "@google/genai";

const MAX_BYTES = 20 * 1024 * 1024;
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || !apiKey.trim()) {
  console.error(
    "[mcp-vision] GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey",
  );
  process.exit(1);
}

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ai = new GoogleGenAI({ apiKey });

async function loadAsInlineData(image) {
  if (typeof image !== "string" || !image.trim()) {
    throw new Error("`image` must be a non-empty string (local file path or http(s) URL).");
  }

  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(`Failed to fetch image: HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") || "";
    const mimeType =
      contentType.split(";")[0].trim() ||
      MIME_BY_EXT[extname(new URL(image).pathname).toLowerCase()] ||
      "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`Image too large: ${buf.byteLength} bytes (max ${MAX_BYTES}).`);
    }
    if (!mimeType.startsWith("image/")) {
      throw new Error(`URL did not return an image (content-type: ${contentType}).`);
    }
    return { data: buf.toString("base64"), mimeType };
  }

  const p = isAbsolute(image) ? image : resolve(process.cwd(), image);
  const st = await stat(p);
  if (!st.isFile()) throw new Error(`Not a file: ${p}`);
  if (st.size > MAX_BYTES) {
    throw new Error(`Image too large: ${st.size} bytes (max ${MAX_BYTES}).`);
  }
  const buf = await readFile(p);
  const mimeType = MIME_BY_EXT[extname(p).toLowerCase()] || "image/jpeg";
  return { data: buf.toString("base64"), mimeType };
}

const server = new Server(
  { name: "mcp-vision", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "analyze_image",
      description:
        "Analyze an image using a vision-capable Gemini model. Pass a local file path or an http(s) URL, plus an optional prompt/question. Returns the model's textual description or answer. Use this when the calling agent lacks vision and needs to understand an image (screenshots, diagrams, UI mockups, photos).",
      inputSchema: {
        type: "object",
        properties: {
          image: {
            type: "string",
            description: "Local file path or http(s) URL of the image to analyze.",
          },
          prompt: {
            type: "string",
            description:
              "Question or instruction for the vision model. Defaults to a detailed description.",
          },
        },
        required: ["image"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  if (name !== "analyze_image") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const { image, prompt } = args;
  const instruction =
    typeof prompt === "string" && prompt.trim()
      ? prompt.trim()
      : "Describe this image in detail. Note any text, UI elements, layout, colors, and notable objects.";

  try {
    const inline = await loadAsInlineData(image);
    const result = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: instruction }, { inlineData: inline }],
        },
      ],
    });
    const text = result.text || "(no response)";
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return {
      content: [{ type: "text", text: `analyze_image failed: ${msg}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
