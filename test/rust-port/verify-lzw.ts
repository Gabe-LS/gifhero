/**
 * Cross-validate Rust LZW against TypeScript LZW.
 *
 * Creates known indexed pixel buffers, runs TS lzwEncode on them,
 * and prints the output as hex for comparison against Rust.
 *
 * Usage: npx tsx test/rust-port/verify-lzw.ts
 */

import { lzwEncode } from "../../src/encoder/lzw.js";
import { lzwEncodeLossy } from "../../src/encoder/lossy-lzw.js";

interface TestCase {
  name: string;
  pixels: Uint8Array;
  minCodeSize: number;
  palette?: Uint8Array;
  lossiness?: number;
}

const cases: TestCase[] = [
  {
    name: "solid-4x4-idx0",
    pixels: new Uint8Array(16).fill(0),
    minCodeSize: 2,
  },
  {
    name: "alternating-4colors",
    pixels: new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]),
    minCodeSize: 2,
  },
  {
    name: "gradient-256",
    pixels: new Uint8Array(256).map((_, i) => i),
    minCodeSize: 8,
  },
  {
    name: "repetitive-1000",
    pixels: new Uint8Array(1000).map((_, i) => i % 64),
    minCodeSize: 7,
  },
  {
    name: "large-repetitive-5000",
    pixels: new Uint8Array(5000).map((_, i) => i % 32),
    minCodeSize: 5,
  },
];

console.log("=== Standard LZW ===");
for (const tc of cases) {
  const encoded = lzwEncode(tc.pixels, tc.minCodeSize);
  console.log(JSON.stringify({
    name: tc.name,
    inputLen: tc.pixels.length,
    minCodeSize: tc.minCodeSize,
    outputLen: encoded.length,
    hex: Buffer.from(encoded).toString("hex"),
  }));
}

console.log("\n=== Lossy LZW ===");
const lossyPalette = new Uint8Array(16 * 3);
for (let i = 0; i < 16; i++) {
  lossyPalette[i * 3] = i * 16;
  lossyPalette[i * 3 + 1] = i * 16;
  lossyPalette[i * 3 + 2] = i * 16;
}

const lossyCases: { name: string; pixels: Uint8Array; minCodeSize: number; lossiness: number }[] = [
  {
    name: "lossy-zero",
    pixels: new Uint8Array(100).map((_, i) => i % 16),
    minCodeSize: 4,
    lossiness: 0,
  },
  {
    name: "lossy-20",
    pixels: new Uint8Array(1000).map((_, i) => i % 16),
    minCodeSize: 4,
    lossiness: 20,
  },
  {
    name: "lossy-5",
    pixels: new Uint8Array(500).map((_, i) => i % 8),
    minCodeSize: 4,
    lossiness: 5,
  },
];

const losslessRef = lzwEncode(
  new Uint8Array(100).map((_, i) => i % 16),
  4,
);
console.log(JSON.stringify({
  name: "lossless-ref-100",
  outputLen: losslessRef.length,
  hex: Buffer.from(losslessRef).toString("hex"),
}));

for (const tc of lossyCases) {
  const encoded = lzwEncodeLossy(tc.pixels, lossyPalette, tc.minCodeSize, tc.lossiness);
  console.log(JSON.stringify({
    name: tc.name,
    inputLen: tc.pixels.length,
    minCodeSize: tc.minCodeSize,
    lossiness: tc.lossiness,
    outputLen: encoded.length,
    hex: Buffer.from(encoded).toString("hex"),
  }));
}
