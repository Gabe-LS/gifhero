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

export function quantize_no_dither(rgba: Uint8Array, width: number, height: number, quality_min: number, quality_max: number, speed: number, max_colors: number, background_rgba: Uint8Array, importance_map: Uint8Array): QuantResult;

export function quantize_simple(rgba: Uint8Array, width: number, height: number, quality_min: number, quality_max: number, speed: number, max_colors: number): QuantResult;

export function quantize_with_background(rgba: Uint8Array, width: number, height: number, quality_min: number, quality_max: number, speed: number, max_colors: number, background_rgba: Uint8Array, importance_map: Uint8Array): QuantResult;
