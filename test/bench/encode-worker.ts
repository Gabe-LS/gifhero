/**
 * Worker thread for parallel GIF encoding.
 *
 * Each worker gets its own V8 isolate and WASM instance,
 * enabling true CPU parallelism on multi-core machines.
 */

import { parentPort, workerData } from "worker_threads";
import { encode } from "../../src/index.js";
import type { EncodeOptions } from "../../src/index.js";

interface WorkerInput {
  frameBuffers: ArrayBuffer[];
  width: number;
  height: number;
  delay: number;
  options: Omit<EncodeOptions, "width" | "height" | "frames">;
}

const { frameBuffers, width, height, delay, options } = workerData as WorkerInput;

const frames = frameBuffers.map((buf: ArrayBuffer) => ({
  data: new Uint8ClampedArray(buf),
  delay,
}));

encode({ width, height, frames, ...options })
  .then((gif) => {
    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength) as ArrayBuffer;
    parentPort!.postMessage({ gif: buf }, [buf]);
  })
  .catch((err) => {
    parentPort!.postMessage({ error: (err as Error).message });
  });
