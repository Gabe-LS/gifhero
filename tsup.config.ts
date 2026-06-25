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
    noExternal: [/.*/],
    external: ["fs", "module", "path", "zlib"],
    splitting: false,
  },
  {
    entry: { "browser-worker": "src/browser/worker/encode-worker.ts" },
    format: ["esm"],
    noExternal: [/.*/],
    external: ["fs", "module", "path", "zlib"],
    splitting: false,
  },
  {
    entry: { "video-worker": "src/browser/worker/video-worker.ts" },
    format: ["esm"],
    noExternal: [/.*/],
    external: ["fs", "module", "path", "zlib"],
    splitting: false,
  },
  {
    entry: { "gifski-mt-video-worker": "test/browser/gifski-mt-video-worker.ts" },
    format: ["esm"],
    outDir: "test/browser/dist",
    noExternal: [/mediabunny/],
    external: ["fs", "module", "path", "zlib"],
    splitting: false,
  },
]);
