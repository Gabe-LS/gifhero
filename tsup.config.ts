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
    noExternal: [/^(?!imagequant)/],
    external: ["fs", "module", "path", "zlib", "imagequant", "imagequant/imagequant_bg.js"],
    splitting: false,
  },
  {
    entry: { "browser-worker": "src/browser/worker/encode-worker.ts" },
    format: ["esm"],
    noExternal: [/^(?!imagequant)/],
    external: ["fs", "module", "path", "zlib", "imagequant", "imagequant/imagequant_bg.js"],
    splitting: false,
  },
  {
    entry: { "video-worker": "src/browser/worker/video-worker.ts" },
    format: ["esm"],
    noExternal: [/^(?!imagequant)/],
    external: ["fs", "module", "path", "zlib", "imagequant", "imagequant/imagequant_bg.js"],
    splitting: false,
  },
]);
