/* @ts-self-types="./imagequant_gif_wasm.d.ts" */

class QuantResult {
    static __wrap(ptr) {
        const obj = Object.create(QuantResult.prototype);
        obj.__wbg_ptr = ptr;
        QuantResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        QuantResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_quantresult_free(ptr, 0);
    }
    /**
     * @returns {Uint8Array}
     */
    get indices() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.quantresult_indices(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Uint8Array}
     */
    get palette() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.quantresult_palette(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU8FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export2(r0, r1 * 1, 1);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    get palette_count() {
        const ret = wasm.quantresult_palette_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get transparent_index() {
        const ret = wasm.quantresult_transparent_index(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) QuantResult.prototype[Symbol.dispose] = QuantResult.prototype.free;
exports.QuantResult = QuantResult;

/**
 * Build a shared palette from multiple sampled frames.
 * Takes a flat array of RGBA frame data concatenated together,
 * with frame_count indicating how many frames are in the array.
 * Each frame is width × height × 4 bytes.
 * @param {Uint8Array} frames_rgba
 * @param {number} width
 * @param {number} height
 * @param {number} frame_count
 * @param {number} quality_min
 * @param {number} quality_max
 * @param {number} speed
 * @param {number} max_colors
 * @returns {Uint8Array}
 */
function build_shared_palette(frames_rgba, width, height, frame_count, quality_min, quality_max, speed, max_colors) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(frames_rgba, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.build_shared_palette(retptr, ptr0, len0, width, height, frame_count, quality_min, quality_max, speed, max_colors);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export2(r0, r1 * 1, 1);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.build_shared_palette = build_shared_palette;

/**
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} quality_min
 * @param {number} quality_max
 * @param {number} speed
 * @param {number} max_colors
 * @param {Uint8Array} background_rgba
 * @param {Uint8Array} importance_map
 * @returns {QuantResult}
 */
function quantize_no_dither(rgba, width, height, quality_min, quality_max, speed, max_colors, background_rgba, importance_map) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(rgba, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(background_rgba, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(importance_map, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.quantize_no_dither(retptr, ptr0, len0, width, height, quality_min, quality_max, speed, max_colors, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return QuantResult.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.quantize_no_dither = quantize_no_dither;

/**
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} quality_min
 * @param {number} quality_max
 * @param {number} speed
 * @param {number} max_colors
 * @returns {QuantResult}
 */
function quantize_simple(rgba, width, height, quality_min, quality_max, speed, max_colors) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(rgba, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        wasm.quantize_simple(retptr, ptr0, len0, width, height, quality_min, quality_max, speed, max_colors);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return QuantResult.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.quantize_simple = quantize_simple;

/**
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {number} quality_min
 * @param {number} quality_max
 * @param {number} speed
 * @param {number} max_colors
 * @param {Uint8Array} background_rgba
 * @param {Uint8Array} importance_map
 * @returns {QuantResult}
 */
function quantize_with_background(rgba, width, height, quality_min, quality_max, speed, max_colors, background_rgba, importance_map) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(rgba, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(background_rgba, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(importance_map, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.quantize_with_background(retptr, ptr0, len0, width, height, quality_min, quality_max, speed, max_colors, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return QuantResult.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.quantize_with_background = quantize_with_background;

/**
 * Remap a frame using a pre-built shared palette, with background
 * awareness for seamless transparency.
 * @param {Uint8Array} rgba
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} palette_rgba
 * @param {Uint8Array} background_rgba
 * @param {number} dither
 * @returns {QuantResult}
 */
function remap_with_palette(rgba, width, height, palette_rgba, background_rgba, dither) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(rgba, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(palette_rgba, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(background_rgba, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.remap_with_palette(retptr, ptr0, len0, width, height, ptr1, len1, ptr2, len2, dither);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return QuantResult.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}
exports.remap_with_palette = remap_with_palette;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_ea4887a5f8f9a9db: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
    };
    return {
        __proto__: null,
        "./imagequant_gif_wasm_bg.js": import0,
    };
}

const QuantResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_quantresult_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

// Universal WASM loading: base64-embedded, works in Node.js + browsers + workers
let wasm;

function _initWasm(bytes) {
    const wasmModule = new WebAssembly.Module(bytes);
    const wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
    wasm = wasmInstance.exports;
}

function _ensureWasm() {
    if (wasm) return;
    // Try Node.js fs first (faster, avoids base64 decode)
    try {
        const fs = typeof require === 'function' && require('fs');
        const path = typeof require === 'function' && require('path');
        if (fs && path && typeof __dirname !== 'undefined') {
            const wasmPath = path.join(__dirname, 'imagequant_gif_wasm_bg.wasm');
            _initWasm(fs.readFileSync(wasmPath));
            return;
        }
    } catch (_) { /* not Node.js */ }
    // Fallback: decode base64-embedded WASM
    const { wasmBase64 } = require('./imagequant_gif_wasm_bg.b64.js');
    const binaryString = typeof atob === 'function'
        ? atob(wasmBase64)
        : Buffer.from(wasmBase64, 'base64').toString('binary');
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    _initWasm(bytes);
}

_ensureWasm();
