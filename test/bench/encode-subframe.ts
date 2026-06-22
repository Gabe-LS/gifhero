import { readFileSync, writeFileSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { quantizeImagequant } from "../../src/quantizers/imagequant.js";
import { neuquant } from "../../src/quantizers/neuquant.js";
import { floydSteinberg } from "../../src/dither/floyd-steinberg.js";
import { writeGif } from "../../src/encoder/gif-writer.js";
import { lzwEncodeLossy } from "../../src/encoder/lossy-lzw.js";
import type { GifFrame } from "../../src/encoder/gif-writer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "generated", "talking-head");

const files = readdirSync(FIXTURE).filter(f => f.endsWith(".png")).sort();
let W = 0, H = 0;
const srcFrames: Uint8ClampedArray[] = [];
for (const f of files) {
  const img = new Image(); img.src = readFileSync(join(FIXTURE, f));
  if (!W) { W = img.width; H = img.height; }
  const c = createCanvas(W, H); const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  srcFrames.push(ctx.getImageData(0, 0, W, H).data);
}

function cropRgba(src: Uint8ClampedArray, srcW: number, left: number, top: number, cw: number, ch: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((top + y) * srcW + left) * 4;
    out.set(src.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return out;
}

// ── Optimization 1: Color table trimming ──

function trimPalette(
  palette: Uint8Array, indexed: Uint8Array, transparentIndex?: number,
): { palette: Uint8Array; indexed: Uint8Array; transparentIndex?: number } {
  const used = new Uint8Array(256);
  for (let i = 0; i < indexed.length; i++) used[indexed[i]] = 1;
  if (transparentIndex != null && transparentIndex >= 0) used[transparentIndex] = 1;

  const oldToNew = new Uint8Array(256);
  let count = 0;
  for (let i = 0; i < 256; i++) {
    if (used[i]) { oldToNew[i] = count; count++; }
  }
  if (count >= (palette.length / 3)) {
    return { palette, indexed, transparentIndex };
  }

  const newPal = new Uint8Array(count * 3);
  let slot = 0;
  for (let i = 0; i < 256; i++) {
    if (!used[i]) continue;
    const oi = i * 3;
    if (oi + 2 < palette.length) {
      newPal[slot * 3] = palette[oi];
      newPal[slot * 3 + 1] = palette[oi + 1];
      newPal[slot * 3 + 2] = palette[oi + 2];
    }
    slot++;
  }

  const remapped = new Uint8Array(indexed.length);
  for (let i = 0; i < indexed.length; i++) remapped[i] = oldToNew[indexed[i]];

  return {
    palette: newPal,
    indexed: remapped,
    transparentIndex: transparentIndex != null && transparentIndex >= 0
      ? oldToNew[transparentIndex]
      : transparentIndex,
  };
}

// ── Optimization 2: Color substitution ──

function colorSubstitution(
  indexed: Uint8Array, palette: Uint8Array, w: number, h: number,
  transparentIndex: number,
): Uint8Array {
  const out = new Uint8Array(indexed);
  for (let y = 0; y < h; y++) {
    const rowOff = y * w;
    for (let x = 1; x < w; x++) {
      const cur = out[rowOff + x];
      const prev = out[rowOff + x - 1];
      if (cur === prev) continue;
      if (cur === transparentIndex || prev === transparentIndex) continue;
      const ci = cur * 3, pi = prev * 3;
      const d = Math.max(
        Math.abs(palette[ci] - palette[pi]),
        Math.abs(palette[ci + 1] - palette[pi + 1]),
        Math.abs(palette[ci + 2] - palette[pi + 2]),
      );
      if (d <= 2) out[rowOff + x] = prev;
    }
  }
  return out;
}

// ── Optimization 3: Transparency run equalization ──

function transparencyRunEq(
  indexed: Uint8Array, w: number, h: number,
  transparentIndex: number,
  currRgba: Uint8ClampedArray, prevRgba: Uint8ClampedArray,
  cropLeft: number, cropTop: number, fullW: number,
): Uint8Array {
  const out = new Uint8Array(indexed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (out[i] === transparentIndex) continue;
      let tNeighbors = 0;
      for (let dy = Math.max(0, y - 1); dy <= Math.min(h - 1, y + 1); dy++) {
        for (let dx = Math.max(0, x - 1); dx <= Math.min(w - 1, x + 1); dx++) {
          if (dy === y && dx === x) continue;
          if (out[dy * w + dx] === transparentIndex) tNeighbors++;
        }
      }
      if (tNeighbors < 6) continue;
      const si = ((cropTop + y) * fullW + (cropLeft + x)) * 4;
      const d = Math.max(
        Math.abs(currRgba[si] - prevRgba[si]),
        Math.abs(currRgba[si + 1] - prevRgba[si + 1]),
        Math.abs(currRgba[si + 2] - prevRgba[si + 2]),
      );
      if (d <= 3) out[i] = transparentIndex;
    }
  }
  return out;
}

// ── Hole punching ──

interface PunchResult {
  indexedPixels: Uint8Array;
  transparentIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

function punchHoles(
  indexedPixels: Uint8Array,
  palette: Uint8Array,
  currRgba: Uint8ClampedArray,
  prevRgba: Uint8ClampedArray,
  cropLeft: number, cropTop: number, cw: number, ch: number,
  fullW: number, tolerance: number,
): PunchResult {
  const pixelCount = cw * ch;
  const changed = new Uint8Array(pixelCount);

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((cropTop + y) * fullW + (cropLeft + x)) * 4;
      const d = Math.max(
        Math.abs(currRgba[si] - prevRgba[si]),
        Math.abs(currRgba[si + 1] - prevRgba[si + 1]),
        Math.abs(currRgba[si + 2] - prevRgba[si + 2]),
      );
      if (d > tolerance) changed[y * cw + x] = 1;
    }
  }

  const neighborCount = new Uint8Array(pixelCount);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (!changed[y * cw + x]) continue;
      let count = 0;
      for (let dy = Math.max(0, y - 2); dy <= Math.min(ch - 1, y + 2); dy++) {
        for (let dx = Math.max(0, x - 2); dx <= Math.min(cw - 1, x + 2); dx++) {
          if (dy === y && dx === x) continue;
          if (changed[dy * cw + dx]) count++;
        }
      }
      neighborCount[y * cw + x] = count;
    }
  }
  for (let i = 0; i < pixelCount; i++) {
    if (changed[i] && neighborCount[i] < 6) changed[i] = 0;
  }

  const usedByChanged = new Uint8Array(256);
  let minX = cw, maxX = -1, minY = ch, maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (changed[i]) {
        usedByChanged[indexedPixels[i]] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return { indexedPixels: new Uint8Array([0]), transparentIndex: 0, left: 0, top: 0, width: 1, height: 1 };
  }

  const numColors = palette.length / 3;
  let palBits = 1;
  while ((1 << palBits) < numColors) palBits++;
  const maxIdx = (1 << palBits) - 1;

  let tIdx = -1;
  for (let i = maxIdx; i >= 0; i--) {
    if (!usedByChanged[i]) { tIdx = i; break; }
  }
  if (tIdx < 0) {
    return {
      indexedPixels: indexedPixels.slice(), transparentIndex: -1,
      left: cropLeft, top: cropTop, width: cw, height: ch,
    };
  }

  const outW = maxX - minX + 1;
  const outH = maxY - minY + 1;
  const out = new Uint8Array(outW * outH);
  for (let cy = 0; cy < outH; cy++) {
    for (let cx = 0; cx < outW; cx++) {
      const srcI = (minY + cy) * cw + (minX + cx);
      out[cy * outW + cx] = changed[srcI] ? indexedPixels[srcI] : tIdx;
    }
  }

  return {
    indexedPixels: out, transparentIndex: tIdx,
    left: cropLeft + minX, top: cropTop + minY, width: outW, height: outH,
  };
}

// ── Encode pipeline ──

interface OptFlags { trim: boolean; colsub: boolean; transeq: boolean }

async function encodeSubframe(
  cropTol: number, holeTol: number, lossyLzw: number, opts: OptFlags,
): Promise<Uint8Array> {
  const gifFrames: GifFrame[] = [];

  for (let i = 0; i < srcFrames.length; i++) {
    const curr = srcFrames[i];
    if (i === 0) {
      const r = await quantizeImagequant(curr, W, H, { quality: 90, speed: 1, maxColors: 256 });
      let px: Uint8Array, pal: Uint8Array;
      if (r) { px = r.indexed; pal = r.palette; }
      else { pal = neuquant(curr, 1); px = floydSteinberg(curr, W, H, pal, true); }
      if (opts.trim) {
        const t = trimPalette(pal, px);
        px = t.indexed; pal = t.palette;
      }
      gifFrames.push({ indexedPixels: px, palette: pal, width: W, height: H, delay: 5, disposal: 0 });
      continue;
    }
    const prev = srcFrames[i - 1];

    let minX = W, maxX = -1, minY = H, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 4;
        const d = Math.max(
          Math.abs(curr[si] - prev[si]),
          Math.abs(curr[si + 1] - prev[si + 1]),
          Math.abs(curr[si + 2] - prev[si + 2]),
        );
        if (d > cropTol) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) {
      gifFrames.push({
        indexedPixels: new Uint8Array([0]), palette: gifFrames[i - 1].palette,
        width: 1, height: 1, left: 0, top: 0, delay: 5, disposal: 0, transparentIndex: 0,
      });
      continue;
    }

    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const cropped = cropRgba(curr, W, minX, minY, cw, ch);
    const r = await quantizeImagequant(cropped, cw, ch, { quality: 90, speed: 1, maxColors: 256 });
    let px: Uint8Array, pal: Uint8Array;
    if (r) { px = r.indexed; pal = r.palette; }
    else { pal = neuquant(cropped, 1); px = floydSteinberg(cropped, cw, ch, pal, true); }

    // Hole punch
    const punched = punchHoles(px, pal, curr, prev, minX, minY, cw, ch, W, holeTol);
    let fpx = punched.indexedPixels;
    let fw = punched.width, fh = punched.height;
    let fl = punched.left, ft = punched.top;
    let tIdx = punched.transparentIndex;

    // Post-processing optimizations (only when we have transparency)
    if (tIdx >= 0) {
      if (opts.colsub) {
        fpx = colorSubstitution(fpx, pal, fw, fh, tIdx);
      }
      if (opts.transeq) {
        fpx = transparencyRunEq(fpx, fw, fh, tIdx, curr, prev, fl, ft, W);
      }
    }

    if (opts.trim && tIdx >= 0) {
      const t = trimPalette(pal, fpx, tIdx);
      pal = t.palette; fpx = t.indexed;
      tIdx = t.transparentIndex != null ? t.transparentIndex : -1;
    }

    gifFrames.push({
      indexedPixels: fpx, palette: pal,
      width: fw, height: fh, left: fl, top: ft,
      transparentIndex: tIdx >= 0 ? tIdx : undefined,
      delay: 5, disposal: 0,
    });
  }

  let enc: ((p: Uint8Array, m: number) => Uint8Array) | undefined;
  if (lossyLzw > 0) {
    let fi = 0;
    enc = (pixels: Uint8Array, minCodeSize: number) => {
      const f = gifFrames[Math.min(fi, gifFrames.length - 1)]; fi++;
      return lzwEncodeLossy(pixels, f.palette, minCodeSize, lossyLzw, f.transparentIndex ?? -1);
    };
  }
  return writeGif(gifFrames, { width: W, height: H, loop: 0, lzwEncoder: enc });
}

function measureVmaf(gifPath: string): number {
  const fixture = join(__dirname, "..", "fixtures", "generated", "talking-head");
  const out = execSync(
    `ffmpeg -y -framerate 20 -start_number 1 -i "${fixture}/%04d.png" -i "${gifPath}" ` +
    `-lavfi "[0:v]scale=${W}:${H}:flags=lanczos,format=yuv444p,trim=end_frame=60[ref];` +
    `[1:v]scale=${W}:${H}:flags=lanczos,format=yuv444p,trim=end_frame=60[dist];` +
    `[dist][ref]libvmaf=model=version=vmaf_v0.6.1" -f null - 2>&1`,
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const m = out.match(/VMAF score:\s+([\d.]+)/);
  return m ? parseFloat(m[1]) : -1;
}

async function main() {
  const CROP_TOL = 5;
  const HOLE_TOL = 0;
  const LOSSY_LZW = 4;

  const configs: Array<{ label: string; opts: OptFlags }> = [
    { label: "baseline",  opts: { trim: false, colsub: false, transeq: false } },
    { label: "trim",      opts: { trim: true,  colsub: false, transeq: false } },
    { label: "colsub",    opts: { trim: false, colsub: true,  transeq: false } },
    { label: "transeq",   opts: { trim: false, colsub: false, transeq: true  } },
    { label: "all-three",  opts: { trim: true,  colsub: true,  transeq: true  } },
  ];

  const results: Array<{ label: string; vmaf: number; sizeKB: number }> = [];

  for (const cfg of configs) {
    console.log(`Encoding ${cfg.label}...`);
    const gif = await encodeSubframe(CROP_TOL, HOLE_TOL, LOSSY_LZW, cfg.opts);
    const path = join(__dirname, "references", `talking-head-opt-${cfg.label}.gif`);
    writeFileSync(path, gif);
    const sizeKB = Math.round(gif.length / 1024);
    console.log(`  ${sizeKB}KB. Measuring VMAF...`);
    const vmaf = measureVmaf(path);
    console.log(`  VMAF: ${vmaf.toFixed(1)}`);
    results.push({ label: cfg.label, vmaf, sizeKB });
  }

  const base = results[0];
  console.log("\n┌────────────────┬────────┬──────────┬──────────┐");
  console.log("│ Config         │ VMAF   │ Size     │ Saving   │");
  console.log("├────────────────┼────────┼──────────┼──────────┤");
  console.log("│ gifski         │  97.2  │ 2016 KB  │    —     │");
  for (const r of results) {
    const label = r.label.padEnd(14);
    const vmaf = r.vmaf.toFixed(1).padStart(5);
    const size = `${r.sizeKB} KB`.padStart(7);
    const saving = r === base ? "  —  " : `${(base.sizeKB - r.sizeKB)} KB`.padStart(6);
    console.log(`│ ${label} │ ${vmaf}  │ ${size}  │ ${saving}   │`);
  }
  console.log("└────────────────┴────────┴──────────┴──────────┘");

  const allThree = results.find(r => r.label === "all-three")!;
  const target = allThree.sizeKB <= 2136 && allThree.vmaf >= 96.5;
  console.log(`\nTarget ≤2136KB & ≥96.5 VMAF: ${target ? "HIT" : "MISS"} (${allThree.sizeKB}KB, VMAF ${allThree.vmaf.toFixed(1)})`);
}
main().catch(console.error);
