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

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { type, id, frameBuffers, delays, width, height, options } = e.data;
  if (type !== "encode") return;

  const frames: EncodeFrame[] = frameBuffers.map((buf, i) => ({
    data: new Uint8ClampedArray(buf),
    delay: delays[i],
  }));

  try {
    const gif = await encode({ width, height, frames, ...options });
    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
    (self as unknown as Worker).postMessage({ type: "result", id, gif: buf }, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: "error", id, message: (err as Error).message });
  }
};
