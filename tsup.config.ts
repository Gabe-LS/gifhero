import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
  },
  {
    entry: { browser: "src/browser/index.ts" },
    format: ["esm"],
    dts: true,
  },
  {
    entry: { "browser-worker": "src/browser/worker/encode-worker.ts" },
    format: ["esm"],
  },
]);
