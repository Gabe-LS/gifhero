/**
 * Frame worker for parallel Lanczos3 downscaling and quantization.
 *
 * Handles two task types:
 * - "downsample": Lanczos3 resize (pure JS, no WASM needed)
 * - "quantize": imagequant remap with shared palette + approximate canvas
 *
 * Each worker instance loads the WASM lazily on first quantize task.
 *
 * @module
 */

import { parentPort } from "worker_threads";
import {
  remapWithPalette as gifRemapPalette,
  quantizeSimple as gifQuantSimple,
  downsampleWasm,
} from "../quantizers/imagequant-gif.js";

interface DownsampleTask {
  type: "downsample";
  id: number;
  frameBuffer: ArrayBuffer;
  srcW: number;
  srcH: number;
  dstW: number;
  dstH: number;
}

interface QuantizeTask {
  type: "quantize";
  id: number;
  frameBuffer: ArrayBuffer;
  width: number;
  height: number;
  paletteBuffer: ArrayBuffer;
  canvasBuffer: ArrayBuffer;
  staticMaskBuffer: ArrayBuffer;
  staleThreshold: number;
  quality: number;
  speed: number;
  maxColors: number;
  isKeyframe: boolean;
}

parentPort!.on("message", (task: DownsampleTask | QuantizeTask) => {
  if (task.type === "downsample") {
    const src = new Uint8ClampedArray(task.frameBuffer);
    const result = downsampleWasm(src, task.srcW, task.srcH, task.dstW, task.dstH);
    const buf = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
    parentPort!.postMessage({ id: task.id, buffer: buf }, [buf]);
  } else if (task.type === "quantize") {
    const frameData = new Uint8ClampedArray(task.frameBuffer);
    const width = task.width, height = task.height;
    const numPixels = width * height;

    if (task.isKeyframe) {
      const r = gifQuantSimple(frameData, width, height, task.quality, task.speed, task.maxColors);
      const palBuf = r.palette.buffer.slice(r.palette.byteOffset, r.palette.byteOffset + r.palette.byteLength);
      const idxBuf = r.indexed.buffer.slice(r.indexed.byteOffset, r.indexed.byteOffset + r.indexed.byteLength);
      parentPort!.postMessage({
        id: task.id,
        paletteBuf: palBuf,
        indexedBuf: idxBuf,
        paletteCount: r.paletteCount,
        transparentIndex: r.transparentIndex,
      }, [palBuf, idxBuf]);
      return;
    }

    const sharedPalette = new Uint8Array(task.paletteBuffer);
    const approxCanvas = new Uint8ClampedArray(task.canvasBuffer);
    const staticMask = new Uint8Array(task.staticMaskBuffer);

    // Alpha zeroing: static mask + stale threshold (using approximate canvas)
    const inputRgba = new Uint8ClampedArray(frameData);
    for (let j = 0; j < numPixels; j++) {
      if (staticMask[j]) { inputRgba[j * 4 + 3] = 0; continue; }
      const si = j * 4;
      const d = Math.max(
        Math.abs(inputRgba[si] - approxCanvas[si]),
        Math.abs(inputRgba[si + 1] - approxCanvas[si + 1]),
        Math.abs(inputRgba[si + 2] - approxCanvas[si + 2]),
      );
      if (d <= task.staleThreshold) inputRgba[si + 3] = 0;
    }

    const r = gifRemapPalette(inputRgba, width, height, sharedPalette, approxCanvas);
    const palBuf = r.palette.buffer.slice(r.palette.byteOffset, r.palette.byteOffset + r.palette.byteLength);
    const idxBuf = r.indexed.buffer.slice(r.indexed.byteOffset, r.indexed.byteOffset + r.indexed.byteLength);
    parentPort!.postMessage({
      id: task.id,
      paletteBuf: palBuf,
      indexedBuf: idxBuf,
      paletteCount: r.paletteCount,
      transparentIndex: r.transparentIndex,
    }, [palBuf, idxBuf]);
  }
});
