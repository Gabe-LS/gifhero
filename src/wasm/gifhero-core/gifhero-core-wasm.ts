/**
 * gifhero-core WASM module — universal loader.
 *
 * Embeds the WASM binary as base64 so it works in browsers, workers,
 * and Chrome extensions without fetch/fs. Exposes a single encode_gif()
 * function that takes concatenated RGBA frames and returns a GIF.
 *
 * @module
 */

import { wasmBase64 } from "./gifhero_core_bg.b64.js";

let wasm: any;
let cachedUint8: Uint8Array | null = null;
let cachedDataView: DataView | null = null;
let WASM_VECTOR_LEN = 0;

function getUint8(): Uint8Array {
  if (!cachedUint8 || cachedUint8.byteLength === 0)
    cachedUint8 = new Uint8Array(wasm.memory.buffer);
  return cachedUint8;
}

function getDataView(): DataView {
  if (!cachedDataView || cachedDataView.buffer.detached === true ||
      (cachedDataView.buffer.detached === undefined && cachedDataView.buffer !== wasm.memory.buffer))
    cachedDataView = new DataView(wasm.memory.buffer);
  return cachedDataView;
}

function getArrayU8(ptr: number, len: number): Uint8Array {
  return getUint8().subarray(ptr >>> 0, (ptr >>> 0) + len);
}

function passArray8(arg: Uint8Array | Uint8ClampedArray): number {
  const ptr = wasm.__wbindgen_export(arg.length, 1) >>> 0;
  getUint8().set(arg, ptr);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

function ensureWasm(): void {
  if (wasm) return;
  const binaryString = typeof atob === "function"
    ? atob(wasmBase64)
    : Buffer.from(wasmBase64, "base64").toString("binary");
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  const imports = {
    "./gifhero_core_bg.js": {} as Record<string, never>,
  };
  const mod = new WebAssembly.Module(bytes);
  wasm = new WebAssembly.Instance(mod, imports).exports;
}

export function encode_gif(
  framesRgba: Uint8Array,
  frameCount: number,
  width: number,
  height: number,
  delayMs: number,
  targetWidth: number,
  preset: number,
): Uint8Array {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(framesRgba), l0 = WASM_VECTOR_LEN;
    wasm.encode_gif(retptr, p0, l0, frameCount, width, height, delayMs, targetWidth, preset);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const v = getArrayU8(r0, r1).slice();
    wasm.__wbindgen_export2(r0, r1, 1);
    return v;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
