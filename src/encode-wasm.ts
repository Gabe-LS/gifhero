/**
 * WASM-based GIF encoder using the gifhero-core Rust pipeline.
 *
 * Runs the entire encode pipeline in WASM: probe → quantize →
 * subframe → LZW → GIF assembly. Used by the browser video worker
 * to replace the TS encode pipeline.
 *
 * @module
 */

import { encode_gif } from "./wasm/gifhero-core/gifhero-core-wasm.js";

export function encodeWasm(
  frames: Array<{ data: Uint8ClampedArray; delay: number }>,
  width: number,
  height: number,
  options: {
    preset?: "quality" | "balanced";
    targetWidth?: number;
  } = {},
): Uint8Array {
  const frameSize = width * height * 4;
  const buffer = new Uint8Array(frameSize * frames.length);
  for (let i = 0; i < frames.length; i++) {
    buffer.set(frames[i].data, i * frameSize);
  }

  const delay = frames[0]?.delay ?? 50;
  const preset = options.preset === "quality" ? 1 : 0;
  const targetWidth = options.targetWidth ?? 0;

  return encode_gif(buffer, frames.length, width, height, delay, targetWidth, preset);
}
