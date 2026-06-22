/**
 * Type declarations for the imagequant WASM background module.
 *
 * The `imagequant` npm package ships types for its main entry point
 * but not for `imagequant/imagequant_bg.js`, which is the raw
 * wasm-bindgen glue module used for manual WASM initialization.
 */

declare module "imagequant/imagequant_bg.js" {
  export class Imagequant {
    constructor();
    set_max_colors(max_colors: number): void;
    set_quality(minimum: number, target: number): void;
    set_speed(value: number): void;
    set_min_posterization(value: number): void;
    static new_image(
      data: Uint8Array,
      width: number,
      height: number,
      gamma: number,
    ): ImagequantImage;
    process(image: ImagequantImage): Uint8Array;
    free(): void;
  }

  export class ImagequantImage {
    constructor(
      data: Uint8Array,
      width: number,
      height: number,
      gamma: number,
    );
    free(): void;
  }

  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
