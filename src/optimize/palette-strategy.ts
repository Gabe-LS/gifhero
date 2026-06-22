/**
 * Palette generation strategies for multi-frame GIF encoding.
 *
 * Provides four strategies that trade off encoding speed, palette quality,
 * and cross-frame coherence:
 *
 * - `local`      — independent per-frame quantization
 * - `global`     — single shared palette sampled from representative frames
 * - `crossframe` — adjacent-frame-weighted quantization for smoother transitions
 * - `adaptive`   — automatically picks local, crossframe, or palette reuse per frame
 *
 * @module
 */

import { neuquant } from "../quantizers/index.js";

export type PaletteStrategy = "local" | "global" | "crossframe" | "adaptive";

/**
 * Generate one 256-color RGB palette per frame using the chosen strategy.
 *
 * @param frames - Sequence of frames, each containing RGBA pixel data.
 * @param strategy - Which palette strategy to use.
 * @param quality - NeuQuant sampling quality (1–30, lower = better).
 * @returns Array of flat RGB palettes (768 bytes each), one per frame.
 *   For `global`, every entry is the same `Uint8Array` reference.
 */
export function generatePalettes(
  frames: ReadonlyArray<{ readonly data: Uint8ClampedArray }>,
  strategy: PaletteStrategy,
  quality: number,
): Uint8Array[] {
  if (frames.length === 0) return [];

  switch (strategy) {
    case "local":
      return localStrategy(frames, quality);
    case "global":
      return globalStrategy(frames, quality);
    case "crossframe":
      return crossframeStrategy(frames, quality);
    case "adaptive":
      return adaptiveStrategy(frames, quality);
  }
}

function localStrategy(
  frames: ReadonlyArray<{ readonly data: Uint8ClampedArray }>,
  quality: number,
): Uint8Array[] {
  const palettes: Uint8Array[] = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    palettes[i] = neuquant(frames[i].data, quality);
  }
  return palettes;
}

function globalStrategy(
  frames: ReadonlyArray<{ readonly data: Uint8ClampedArray }>,
  quality: number,
): Uint8Array[] {
  const step = frames.length < 10 ? 1 : 5;
  let totalBytes = 0;
  for (let i = 0; i < frames.length; i += step) {
    totalBytes += frames[i].data.length;
  }

  const pooled = new Uint8ClampedArray(totalBytes);
  let offset = 0;
  for (let i = 0; i < frames.length; i += step) {
    pooled.set(frames[i].data, offset);
    offset += frames[i].data.length;
  }

  const palette = neuquant(pooled, quality);
  const palettes: Uint8Array[] = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    palettes[i] = palette;
  }
  return palettes;
}

function crossframeStrategy(
  frames: ReadonlyArray<{ readonly data: Uint8ClampedArray }>,
  quality: number,
): Uint8Array[] {
  const palettes: Uint8Array[] = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    palettes[i] = crossframeQuantize(frames, i, quality);
  }
  return palettes;
}

function crossframeQuantize(
  frames: ReadonlyArray<{ readonly data: Uint8ClampedArray }>,
  index: number,
  quality: number,
): Uint8Array {
  const current = frames[index].data;
  const prev = index > 0 ? frames[index - 1].data : null;
  const next = index < frames.length - 1 ? frames[index + 1].data : null;

  const prevSampled = prev ? subsampleEveryNth(prev, 3) : null;
  const nextSampled = next ? subsampleEveryNth(next, 3) : null;

  const totalBytes =
    current.length +
    (prevSampled ? prevSampled.length : 0) +
    (nextSampled ? nextSampled.length : 0);

  const combined = new Uint8ClampedArray(totalBytes);
  let offset = 0;

  combined.set(current, offset);
  offset += current.length;

  if (prevSampled) {
    combined.set(prevSampled, offset);
    offset += prevSampled.length;
  }

  if (nextSampled) {
    combined.set(nextSampled, offset);
  }

  return neuquant(combined, quality);
}

function subsampleEveryNth(
  rgba: Uint8ClampedArray,
  n: number,
): Uint8ClampedArray {
  const pixelCount = rgba.length >> 2;
  const sampledCount = Math.ceil(pixelCount / n);
  const result = new Uint8ClampedArray(sampledCount * 4);

  let writeIdx = 0;
  for (let i = 0; i < pixelCount; i += n) {
    const srcOff = i << 2;
    result[writeIdx] = rgba[srcOff];
    result[writeIdx + 1] = rgba[srcOff + 1];
    result[writeIdx + 2] = rgba[srcOff + 2];
    result[writeIdx + 3] = rgba[srcOff + 3];
    writeIdx += 4;
  }

  return result;
}

function adaptiveStrategy(
  frames: ReadonlyArray<{ readonly data: Uint8ClampedArray }>,
  quality: number,
): Uint8Array[] {
  const palettes: Uint8Array[] = new Array(frames.length);
  palettes[0] = neuquant(frames[0].data, quality);

  for (let i = 1; i < frames.length; i++) {
    const changedFraction = estimateChangedFraction(
      frames[i - 1].data,
      frames[i].data,
    );

    if (changedFraction < 0.05) {
      palettes[i] = palettes[i - 1];
    } else if (changedFraction <= 0.3) {
      palettes[i] = crossframeQuantize(frames, i, quality);
    } else {
      palettes[i] = neuquant(frames[i].data, quality);
    }
  }

  return palettes;
}

function estimateChangedFraction(
  prev: Uint8ClampedArray,
  curr: Uint8ClampedArray,
): number {
  const pixelCount = Math.min(prev.length, curr.length) >> 2;
  if (pixelCount === 0) return 1;

  let sampled = 0;
  let changed = 0;

  for (let i = 0; i < pixelCount; i += 10) {
    const off = i << 2;
    const dr = prev[off] - curr[off];
    const dg = prev[off + 1] - curr[off + 1];
    const db = prev[off + 2] - curr[off + 2];
    const l1 = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
    sampled++;
    if (l1 > 15) changed++;
  }

  return changed / sampled;
}
