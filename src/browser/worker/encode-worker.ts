import { encode } from "../../index.js";
import type { EncodeFrame, EncodeOptions } from "../../index.js";

interface EncodeRequest {
  type: "encode";
  id: number;
  frameBuffers: ArrayBuffer[];
  delays: number[];
  width: number;
  height: number;
  options: Omit<EncodeOptions, "width" | "height" | "frames">;
}

console.log("[gifhero-worker] Worker loaded");

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { type, id, frameBuffers, delays, width, height, options } = e.data;
  if (type !== "encode") return;

  console.log(`[gifhero-worker] Received ${frameBuffers.length} frames (${width}×${height}), encoding...`);
  const t0 = performance.now();

  const frames: EncodeFrame[] = frameBuffers.map((buf, i) => ({
    data: new Uint8ClampedArray(buf),
    delay: delays[i],
  }));

  try {
    const gif = await encode({ width, height, frames, ...options });
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[gifhero-worker] Encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB in ${elapsed}s`);
    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
    (self as unknown as Worker).postMessage({ type: "result", id, gif: buf }, [buf]);
  } catch (err) {
    console.error("[gifhero-worker] Encoding failed:", (err as Error).message);
    (self as unknown as Worker).postMessage({ type: "error", id, message: (err as Error).message });
  }
};
