/* tslint:disable */
/* eslint-disable */

export class QuantResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly indices: Uint8Array;
    readonly palette: Uint8Array;
    readonly palette_count: number;
    readonly transparent_index: number;
}

/**
 * Build a shared palette from multiple sampled frames.
 * Takes a flat array of RGBA frame data concatenated together,
 * with frame_count indicating how many frames are in the array.
 * Each frame is width × height × 4 bytes.
 */
export function build_shared_palette(frames_rgba: Uint8Array, width: number, height: number, frame_count: number, quality_min: number, quality_max: number, speed: number, max_colors: number): Uint8Array;

/**
 * Lanczos3 downscale of an RGBA image. Two-pass separable filter
 * with precomputed kernel weights and correct non-premultiplied
 * alpha handling.
 */
export function downsample_lanczos3(src: Uint8Array, src_w: number, src_h: number, dst_w: number, dst_h: number): Uint8Array;

export function quantize_no_dither(rgba: Uint8Array, width: number, height: number, quality_min: number, quality_max: number, speed: number, max_colors: number, background_rgba: Uint8Array, importance_map: Uint8Array): QuantResult;

export function quantize_simple(rgba: Uint8Array, width: number, height: number, quality_min: number, quality_max: number, speed: number, max_colors: number): QuantResult;

export function quantize_with_background(rgba: Uint8Array, width: number, height: number, quality_min: number, quality_max: number, speed: number, max_colors: number, background_rgba: Uint8Array, importance_map: Uint8Array): QuantResult;

/**
 * Remap a frame using a pre-built shared palette, with background
 * awareness for seamless transparency.
 */
export function remap_with_palette(rgba: Uint8Array, width: number, height: number, palette_rgba: Uint8Array, background_rgba: Uint8Array, dither: number): QuantResult;
