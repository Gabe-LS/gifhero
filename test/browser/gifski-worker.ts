/**
 * gifski-wasm benchmark worker.
 *
 * Runs gifski encoding in a Web Worker for fair comparison with
 * gifhero's video worker. Both run single-threaded WASM in the
 * same browser environment.
 */

import { init, encode } from "gifski-wasm";

function wlog(...args: any[]) {
  console.log(`[gifski-wasm ${new Date().toISOString().slice(11, 23)}]`, ...args);
}

interface GifskiRequest {
  type: "encode" | "init";
  id: number;
  wasmUrl?: string;
  frameBuffers?: ArrayBuffer[];
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
  resizeWidth?: number;
}

wlog("Worker loaded");

let initialized = false;

self.onmessage = async (e: MessageEvent<GifskiRequest>) => {
  const { type, id } = e.data;

  if (type === "init") {
    wlog("Initializing WASM from:", e.data.wasmUrl);
    await init(e.data.wasmUrl);
    initialized = true;
    wlog("WASM initialized");
    (self as any).postMessage({ type: "ready", id });
    return;
  }

  if (type !== "encode") return;

  if (!initialized) {
    wlog("Initializing WASM (default)...");
    await init();
    initialized = true;
  }

  const { frameBuffers, width, height, fps, quality, resizeWidth } = e.data;
  wlog(`Received ${frameBuffers!.length} frames (${width}×${height}), encoding at q${quality}...`);
  const t0 = performance.now();

  try {
    const frames = frameBuffers!.map(buf => new Uint8Array(buf));

    const gif = await encode({
      frames,
      width: width!,
      height: height!,
      fps: fps!,
      quality: quality ?? 90,
      ...(resizeWidth ? { resizeWidth } : {}),
    });

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    wlog(`Encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB in ${elapsed}s`);

    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
    (self as any).postMessage({ type: "result", id, gif: buf }, [buf]);
  } catch (err) {
    console.error(`[gifski-wasm ${new Date().toISOString().slice(11, 23)}] Error:`, err);
    (self as any).postMessage({ type: "error", id, message: (err as Error).message });
  }
};
