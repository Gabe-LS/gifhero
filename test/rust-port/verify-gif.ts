/**
 * Cross-validate Rust GIF writer against TypeScript.
 *
 * Creates a simple 2-frame GIF using the TS writeGif, prints hex output.
 *
 * Usage: npx tsx test/rust-port/verify-gif.ts
 */

import { writeGif } from "../../src/encoder/gif-writer.js";
import { lzwEncode } from "../../src/encoder/lzw.js";

// 4x4, 4-color palette (RGB), 2 frames
const w = 4;
const h = 4;
const pixels = w * h;

// Palette: red, blue, green, black (RGB, 3 bytes each)
const palette = new Uint8Array([
  255, 0, 0,    // 0: red
  0, 0, 255,    // 1: blue
  0, 255, 0,    // 2: green
  0, 0, 0,      // 3: black
]);

const frame1 = new Uint8Array(pixels).fill(0); // all red
const frame2 = new Uint8Array(pixels).fill(1); // all blue

const gif = writeGif(
  [
    {
      indexedPixels: frame1,
      palette: palette,
      width: w,
      height: h,
      delay: 10, // centiseconds
      disposal: 1,
      transparentIndex: -1,
    },
    {
      indexedPixels: frame2,
      palette: palette,
      width: w,
      height: h,
      delay: 10,
      disposal: 1,
      transparentIndex: -1,
    },
  ],
  { width: w, height: h, loop: 0 },
);

console.log(JSON.stringify({
  name: "2-frame-solid",
  size: gif.length,
  hex: Buffer.from(gif).toString("hex"),
}));

// Test 2: with transparency
const palette2 = new Uint8Array([
  255, 0, 0,    // 0: red
  0, 255, 0,    // 1: green
  0, 0, 255,    // 2: blue
  255, 255, 0,  // 3: yellow
  0, 0, 0,      // 4: transparent
]);

const frame3 = new Uint8Array([0, 4, 1, 4]);

const gif2 = writeGif(
  [
    {
      indexedPixels: frame3,
      palette: palette2,
      width: 2,
      height: 2,
      delay: 5,
      disposal: 1,
      transparentIndex: 4,
    },
  ],
  { width: 2, height: 2, loop: 0 },
);

console.log(JSON.stringify({
  name: "1-frame-transparent",
  size: gif2.length,
  hex: Buffer.from(gif2).toString("hex"),
}));
