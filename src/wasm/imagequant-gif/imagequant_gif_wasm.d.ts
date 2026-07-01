/* tslint:disable */
/* eslint-disable */

export class FrameEncoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Encode non-keyframe: transparency prep + quantize/remap + bbox +
     * edge sparse suppression + crop + trim palette + canvas update.
     *
     * If `remap_palette` is non-empty, uses fast remap path.
     * Otherwise does full quantize with background.
     */
    encode_frame(rgba: Uint8Array, stale_threshold: number, frame_motion: number, is_quality: boolean, next_frame: Uint8Array, remap_palette: Uint8Array, quality: number, speed: number, max_colors: number, sparse_radius: number): FrameResult;
    /**
     * Encode keyframe (frame 0 or scene change): full quantize, reset canvas.
     */
    encode_keyframe(rgba: Uint8Array, quality: number, speed: number, max_colors: number): FrameResult;
    constructor(width: number, height: number);
    /**
     * Check palette fitness: p95 nearest-color distance.
     */
    palette_p95_distance(rgba: Uint8Array, palette_rgba: Uint8Array): number;
    set_importance_map(map: Uint8Array): void;
    set_static_mask(mask: Uint8Array): void;
}

export class FrameResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly crop_height: number;
    readonly crop_width: number;
    readonly indexed: Uint8Array;
    readonly is_empty: boolean;
    readonly left: number;
    readonly palette_count: number;
    readonly palette_rgb: Uint8Array;
    readonly palette_rgba: Uint8Array;
    readonly top: number;
    readonly transparent_index: number;
}

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
