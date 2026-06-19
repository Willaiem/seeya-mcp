import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outExtension: () => ({ js: ".mjs" }),
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  shims: false,
});
