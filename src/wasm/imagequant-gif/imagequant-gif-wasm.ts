/**
 * libimagequant WASM module — universal loader.
 *
 * Embeds the WASM binary as base64 so it works in Node.js, browsers,
 * workers, and Chrome extensions. Auto-generated glue logic from
 * wasm-bindgen, converted to ESM TypeScript.
 *
 * @module
 */

import { wasmBase64 } from "./imagequant_gif_wasm_bg.b64.js";

// ── WASM initialization ───────────────────────────────────────

let wasm: any;
let cachedUint8: Uint8Array | null = null;
let cachedDataView: DataView | null = null;
let WASM_VECTOR_LEN = 0;

const heap: any[] = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);
let heapNext = heap.length;

function addHeapObject(obj: any): number {
  if (heapNext === heap.length) heap.push(heap.length + 1);
  const idx = heapNext;
  heapNext = heap[idx];
  heap[idx] = obj;
  return idx;
}
function getObject(idx: number): any { return heap[idx]; }
function dropObject(idx: number): void {
  if (idx < 1028) return;
  heap[idx] = heapNext;
  heapNext = idx;
}
function takeObject(idx: number): any {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}

const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
textDecoder.decode();

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
function getStringFromWasm(ptr: number, len: number): string {
  return textDecoder.decode(getUint8().subarray(ptr >>> 0, (ptr >>> 0) + len));
}
function getArrayU8(ptr: number, len: number): Uint8Array {
  return getUint8().subarray(ptr >>> 0, (ptr >>> 0) + len);
}
function passArray8(arg: Uint8Array): number {
  const ptr = wasm.__wbindgen_export(arg.length, 1) >>> 0;
  getUint8().set(arg, ptr);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

// ── QuantResult class ─────────────────────────────────────────

const QuantResultFin = (typeof FinalizationRegistry === "undefined")
  ? { register: () => {}, unregister: () => {} }
  : new FinalizationRegistry((ptr: number) => wasm.__wbg_quantresult_free(ptr, 1));

class QuantResultImpl {
  __wbg_ptr: number;
  constructor(ptr: number) { this.__wbg_ptr = ptr; }
  static __wrap(ptr: number) {
    const obj = new QuantResultImpl(ptr);
    QuantResultFin.register(obj, ptr, obj);
    return obj;
  }
  free() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    QuantResultFin.unregister(this);
    wasm.__wbg_quantresult_free(ptr, 0);
  }
  get indices(): Uint8Array {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      wasm.quantresult_indices(retptr, this.__wbg_ptr);
      return getArrayU8(
        getDataView().getInt32(retptr, true),
        getDataView().getInt32(retptr + 4, true),
      ).slice();
    } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
  }
  get palette(): Uint8Array {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      wasm.quantresult_palette(retptr, this.__wbg_ptr);
      return getArrayU8(
        getDataView().getInt32(retptr, true),
        getDataView().getInt32(retptr + 4, true),
      ).slice();
    } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
  }
  get palette_count(): number { return wasm.quantresult_palette_count(this.__wbg_ptr) >>> 0; }
  get transparent_index(): number { return wasm.quantresult_transparent_index(this.__wbg_ptr); }
}

// ── Exported functions ────────────────────────────────────────

function ensureWasm(): void {
  if (wasm) return;
  const binaryString = typeof atob === "function"
    ? atob(wasmBase64)
    : Buffer.from(wasmBase64, "base64").toString("binary");
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  const imports = {
    "./imagequant_gif_wasm_bg.js": {
      __wbg___wbindgen_throw_ea4887a5f8f9a9db(arg0: number, arg1: number) {
        throw new Error(getStringFromWasm(arg0, arg1));
      },
      __wbindgen_cast_0000000000000001(arg0: number, arg1: number) {
        return addHeapObject(getStringFromWasm(arg0, arg1));
      },
    },
  };
  const mod = new WebAssembly.Module(bytes);
  wasm = new WebAssembly.Instance(mod, imports).exports;
}

export function quantize_with_background(
  rgba: Uint8Array, w: number, h: number,
  qmin: number, qmax: number, speed: number, maxColors: number,
  bg: Uint8Array, imp: Uint8Array,
) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    const p1 = passArray8(bg), l1 = WASM_VECTOR_LEN;
    const p2 = passArray8(imp), l2 = WASM_VECTOR_LEN;
    wasm.quantize_with_background(retptr, p0, l0, w, h, qmin, qmax, speed, maxColors, p1, l1, p2, l2);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
}

export function quantize_simple(
  rgba: Uint8Array, w: number, h: number,
  qmin: number, qmax: number, speed: number, maxColors: number,
) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    wasm.quantize_simple(retptr, p0, l0, w, h, qmin, qmax, speed, maxColors);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
}

export function quantize_no_dither(
  rgba: Uint8Array, w: number, h: number,
  qmin: number, qmax: number, speed: number, maxColors: number,
  bg: Uint8Array, imp: Uint8Array,
) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    const p1 = passArray8(bg), l1 = WASM_VECTOR_LEN;
    const p2 = passArray8(imp), l2 = WASM_VECTOR_LEN;
    wasm.quantize_no_dither(retptr, p0, l0, w, h, qmin, qmax, speed, maxColors, p1, l1, p2, l2);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
}

export function build_shared_palette(
  framesRgba: Uint8Array, w: number, h: number, frameCount: number,
  qmin: number, qmax: number, speed: number, maxColors: number,
): Uint8Array {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(framesRgba), l0 = WASM_VECTOR_LEN;
    wasm.build_shared_palette(retptr, p0, l0, w, h, frameCount, qmin, qmax, speed, maxColors);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    const r3 = getDataView().getInt32(retptr + 12, true);
    if (r3) throw takeObject(r2);
    const v = getArrayU8(r0, r1).slice();
    wasm.__wbindgen_export2(r0, r1, 1);
    return v;
  } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
}

export function remap_with_palette(
  rgba: Uint8Array, w: number, h: number,
  palette: Uint8Array, bg: Uint8Array, dither: number,
) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    const p1 = passArray8(palette), l1 = WASM_VECTOR_LEN;
    const p2 = passArray8(bg), l2 = WASM_VECTOR_LEN;
    wasm.remap_with_palette(retptr, p0, l0, w, h, p1, l1, p2, l2, dither);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally { wasm.__wbindgen_add_to_stack_pointer(16); }
}
