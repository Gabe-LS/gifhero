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
    external: ["fs", "module", "path", "zlib"],
  },
  {
    entry: { "browser-worker": "src/browser/worker/encode-worker.ts" },
    format: ["esm"],
    external: ["fs", "module", "path", "zlib"],
  },
]);
