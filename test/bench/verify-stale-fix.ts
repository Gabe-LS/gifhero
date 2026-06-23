/**
 * Verify the stale canvas check fix + diagnose big-buck-bunny size gap.
 *
 * 1. Encodes all 3 fixtures with quality preset, logs per-frame transparency
 * 2. Measures VMAF for each
 * 3. For big-buck-bunny, does a deep binary comparison vs gifski
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { encode } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");
const REFS_DIR = join(__dirname, "references");
const TEMP_DIR = join(__dirname, ".tmp-verify");

function loadPngFrames(dir: string) {
  const files = readdirSync(dir).filter(f => f.endsWith(".png")).sort();
  let width = 0, height = 0;
  const frames: Array<{ data: Uint8ClampedArray; delay: number }> = [];
  for (const file of files) {
    const img = new Image();
    img.src = readFileSync(join(dir, file));
    if (width === 0) { width = img.width; height = img.height; }
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    frames.push({ data: ctx.getImageData(0, 0, img.width, img.height).data, delay: 50 });
  }
  return { width, height, frames };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── GIF parser with transparent pixel counting ──────────────────

interface FrameInfo {
  index: number;
  width: number;
  height: number;
  left: number;
  top: number;
  hasTransparency: boolean;
  transparentIndex: number;
  lctSize: number;
  lzwBytes: number;
  lctOverhead: number;
  opaquePixels: number;
  transparentPixels: number;
}

function parseGifDetailed(data: Uint8Array): { frames: FrameInfo[]; gctSize: number } {
  let pos = 6;
  const packed = data[pos + 4];
  const hasGCT = !!(packed & 0x80);
  const gctSizeField = packed & 0x07;
  const gctEntries = hasGCT ? (1 << (gctSizeField + 1)) : 0;
  pos += 7;
  if (hasGCT) pos += gctEntries * 3;

  const frames: FrameInfo[] = [];
  let pendingTrans = false;
  let pendingTransIdx = 0;
  let idx = 0;

  while (pos < data.length) {
    const block = data[pos++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = data[pos++];
      if (label === 0xf9) {
        const gcPacked = data[pos + 1];
        pendingTrans = !!(gcPacked & 0x01);
        pendingTransIdx = data[pos + 3];
        pos += data[pos] + 1;
        pos++;
      } else {
        while (data[pos]) { pos += data[pos] + 1; }
        pos++;
      }
      continue;
    }
    if (block === 0x2c) {
      const left = data[pos] | (data[pos + 1] << 8);
      const top = data[pos + 2] | (data[pos + 3] << 8);
      const w = data[pos + 4] | (data[pos + 5] << 8);
      const h = data[pos + 6] | (data[pos + 7] << 8);
      const imgPacked = data[pos + 8];
      pos += 9;
      const hasLCT = !!(imgPacked & 0x80);
      const lctField = imgPacked & 0x07;
      const lctEntries = hasLCT ? (1 << (lctField + 1)) : 0;
      const lctOverhead = hasLCT ? lctEntries * 3 : 0;
      if (hasLCT) pos += lctEntries * 3;

      const minCodeSize = data[pos++];
      const lzwStart = pos;

      // Decode LZW to count transparent vs opaque pixels
      const lzwChunks: Uint8Array[] = [];
      while (data[pos]) {
        const sz = data[pos++];
        lzwChunks.push(data.subarray(pos, pos + sz));
        pos += sz;
      }
      const lzwBytes = pos - lzwStart;
      pos++; // terminator

      // Simple LZW decoder to extract pixel indices
      let opaquePixels = 0;
      let transparentPixels = 0;
      try {
        const decoded = decodeLzw(lzwChunks, minCodeSize, w * h);
        const tIdx = pendingTrans ? pendingTransIdx : -1;
        for (let p = 0; p < decoded.length; p++) {
          if (decoded[p] === tIdx) transparentPixels++;
          else opaquePixels++;
        }
      } catch {
        opaquePixels = w * h;
      }

      frames.push({
        index: idx++,
        width: w, height: h, left, top,
        hasTransparency: pendingTrans,
        transparentIndex: pendingTrans ? pendingTransIdx : -1,
        lctSize: lctEntries,
        lzwBytes,
        lctOverhead,
        opaquePixels,
        transparentPixels,
      });
      pendingTrans = false;
      pendingTransIdx = 0;
      continue;
    }
    while (pos < data.length && data[pos]) { pos += data[pos] + 1; }
    if (pos < data.length) pos++;
  }
  return { frames, gctSize: gctEntries };
}

function decodeLzw(chunks: Uint8Array[], minCodeSize: number, pixelCount: number): Uint8Array {
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const compressed = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { compressed.set(c, off); off += c.length; }

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const output = new Uint8Array(pixelCount);
  let outPos = 0;

  let codeSize = minCodeSize + 1;
  let codeMask = (1 << codeSize) - 1;
  let nextCode = eoiCode + 1;
  const maxTableSize = 4096;

  const table: Uint8Array[] = new Array(maxTableSize);
  for (let i = 0; i <= eoiCode; i++) {
    table[i] = new Uint8Array([i]);
  }

  let bitBuf = 0;
  let bitCount = 0;
  let bytePos = 0;
  let prevEntry: Uint8Array | null = null;

  function readCode(): number {
    while (bitCount < codeSize) {
      if (bytePos >= compressed.length) return eoiCode;
      bitBuf |= compressed[bytePos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuf & codeMask;
    bitBuf >>= codeSize;
    bitCount -= codeSize;
    return code;
  }

  while (outPos < pixelCount) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      codeMask = (1 << codeSize) - 1;
      nextCode = eoiCode + 1;
      prevEntry = null;
      continue;
    }

    let entry: Uint8Array;
    if (code < nextCode) {
      entry = table[code];
    } else if (code === nextCode && prevEntry) {
      entry = new Uint8Array(prevEntry.length + 1);
      entry.set(prevEntry);
      entry[prevEntry.length] = prevEntry[0];
    } else {
      break;
    }

    for (let i = 0; i < entry.length && outPos < pixelCount; i++) {
      output[outPos++] = entry[i];
    }

    if (prevEntry && nextCode < maxTableSize) {
      const newEntry = new Uint8Array(prevEntry.length + 1);
      newEntry.set(prevEntry);
      newEntry[prevEntry.length] = entry[0];
      table[nextCode++] = newEntry;
      if (nextCode > codeMask && codeSize < 12) {
        codeSize++;
        codeMask = (1 << codeSize) - 1;
      }
    }

    prevEntry = entry;
  }

  return output.subarray(0, outPos);
}

// ── VMAF measurement ────────────────────────────────────────────

function computeVmaf(sourceDir: string, gifPath: string, w: number, h: number): number | null {
  mkdirSync(TEMP_DIR, { recursive: true });
  const logPath = join(TEMP_DIR, `${basename(gifPath, ".gif")}-vmaf.json`);
  try {
    execSync(
      `ffmpeg -y -framerate 20 -i "${sourceDir}/%04d.png" -i "${gifPath}" ` +
      `-filter_complex "[1:v]scale=${w}:${h}:flags=bicubic[dist];[0:v][dist]libvmaf=log_path=${logPath}:log_fmt=json" ` +
      `-f null - 2>&1`,
      { encoding: "utf-8", timeout: 300000 },
    );
    return JSON.parse(readFileSync(logPath, "utf-8")).pooled_metrics?.vmaf?.mean ?? null;
  } catch { return null; }
}

// ── Per-fixture verification ────────────────────────────────────

async function verifyFixture(name: string) {
  const dir = join(FIXTURES_DIR, name);
  if (!existsSync(dir)) { console.log(`  Skipping ${name}: not found`); return; }

  console.log(`\n=== ${name} ===`);
  const { width, height, frames } = loadPngFrames(dir);
  console.log(`  ${width}×${height}, ${frames.length} frames`);

  const start = performance.now();
  const gif = await encode({ width, height, frames, preset: "quality" });
  const timeMs = Math.round(performance.now() - start);
  const size = gif.length;

  mkdirSync(REFS_DIR, { recursive: true });
  const gifPath = join(REFS_DIR, `${name}-gifhero-quality.gif`);
  writeFileSync(gifPath, gif);

  const { frames: gifFrames } = parseGifDetailed(gif);
  const transFrames = gifFrames.filter(f => f.hasTransparency).length;
  const subFrames = gifFrames.filter(f => f.width < width || f.height < height).length;
  const avgLzw = gifFrames.reduce((s, f) => s + f.lzwBytes, 0) / gifFrames.length;
  const totalLctOverhead = gifFrames.reduce((s, f) => s + f.lctOverhead, 0);

  // VMAF
  const vmaf = computeVmaf(dir, gifPath, width, height);

  console.log(`  gifhero: ${formatSize(size)}, ${timeMs}ms, VMAF ${vmaf?.toFixed(2) ?? "N/A"}`);
  console.log(`    ${transFrames}/${gifFrames.length} frames with transparency`);
  console.log(`    ${subFrames}/${gifFrames.length} sub-framed`);
  console.log(`    avg LZW: ${Math.round(avgLzw)}B/frame`);
  console.log(`    total LCT overhead: ${formatSize(totalLctOverhead)}`);

  // Per-frame detail
  console.log(`\n  Frame | Dims        | Offset  | LCT  | LZW     | Opaque   | Trans    | Trans%`);
  console.log(`  ------|-------------|---------|------|---------|----------|----------|------`);
  const showFrames = [...Array.from({ length: Math.min(10, gifFrames.length) }, (_, i) => i)];
  if (gifFrames.length > 10) showFrames.push(gifFrames.length - 1);
  for (const fi of showFrames) {
    const f = gifFrames[fi];
    const total = f.opaquePixels + f.transparentPixels;
    const transPct = total > 0 ? ((f.transparentPixels / total) * 100).toFixed(1) : "0.0";
    console.log(
      `  ${String(fi).padStart(5)} | ${`${f.width}×${f.height}`.padEnd(11)} | ${`${f.left},${f.top}`.padEnd(7)} | ` +
      `${(f.lctSize || "GCT").toString().padEnd(4)} | ${`${f.lzwBytes}B`.padEnd(7)} | ` +
      `${String(f.opaquePixels).padEnd(8)} | ${String(f.transparentPixels).padEnd(8)} | ${transPct}%`
    );
  }

  // gifski comparison
  const gifskiPath = join(REFS_DIR, `${name}-gifski.gif`);
  if (existsSync(gifskiPath)) {
    const gifskiData = readFileSync(gifskiPath);
    const gifskiSize = gifskiData.length;
    const { frames: gkFrames, gctSize } = parseGifDetailed(new Uint8Array(gifskiData));
    const gkTrans = gkFrames.filter(f => f.hasTransparency).length;
    const gkSub = gkFrames.filter(f => f.width < width || f.height < height).length;
    const gkAvgLzw = gkFrames.reduce((s, f) => s + f.lzwBytes, 0) / gkFrames.length;
    const gkTotalLct = gkFrames.reduce((s, f) => s + f.lctOverhead, 0);
    const gifskiVmaf = computeVmaf(dir, gifskiPath, width, height);

    console.log(`\n  gifski: ${formatSize(gifskiSize)}, VMAF ${gifskiVmaf?.toFixed(2) ?? "N/A"}`);
    console.log(`    ${gkTrans}/${gkFrames.length} with transparency, ${gkSub}/${gkFrames.length} sub-framed`);
    console.log(`    avg LZW: ${Math.round(gkAvgLzw)}B/frame`);
    console.log(`    total LCT overhead: ${formatSize(gkTotalLct)} (GCT: ${gctSize} colors)`);

    const sizeDelta = ((size - gifskiSize) / gifskiSize * 100).toFixed(0);
    console.log(`\n  Delta: ${sizeDelta}% size`);

    // For big-buck-bunny, detailed diagnosis
    if (name === "big-buck-bunny") {
      console.log(`\n  === big-buck-bunny Size Diagnosis ===`);

      // Compute aggregate stats
      const ghAvgTransPct = gifFrames.slice(1).reduce((s, f) => {
        const total = f.opaquePixels + f.transparentPixels;
        return s + (total > 0 ? f.transparentPixels / total : 0);
      }, 0) / (gifFrames.length - 1) * 100;
      const gkAvgTransPct = gkFrames.slice(1).reduce((s, f) => {
        const total = f.opaquePixels + f.transparentPixels;
        return s + (total > 0 ? f.transparentPixels / total : 0);
      }, 0) / (gkFrames.length - 1) * 100;

      const ghTotalLzw = gifFrames.reduce((s, f) => s + f.lzwBytes, 0);
      const gkTotalLzw = gkFrames.reduce((s, f) => s + f.lzwBytes, 0);

      console.log(`\n                          gifski          gifhero`);
      console.log(`  Avg LZW/frame:          ${`${Math.round(gkAvgLzw)}B`.padEnd(15)} ${`${Math.round(avgLzw)}B`.padEnd(15)}`);
      console.log(`  Total LZW data:         ${formatSize(gkTotalLzw).padEnd(15)} ${formatSize(ghTotalLzw).padEnd(15)}`);
      console.log(`  Avg trans%/frame:       ${`${gkAvgTransPct.toFixed(1)}%`.padEnd(15)} ${`${ghAvgTransPct.toFixed(1)}%`.padEnd(15)}`);
      console.log(`  Total LCT overhead:     ${formatSize(gkTotalLct).padEnd(15)} ${formatSize(totalLctOverhead).padEnd(15)}`);
      console.log(`  File size:              ${formatSize(gifskiSize).padEnd(15)} ${formatSize(size).padEnd(15)}`);

      // Breakdown
      const lzwGap = ghTotalLzw - gkTotalLzw;
      const lctGap = totalLctOverhead - gkTotalLct;
      const totalGap = size - gifskiSize;
      const otherGap = totalGap - lzwGap - lctGap;

      console.log(`\n  Size gap breakdown:`);
      console.log(`    LZW data:             +${formatSize(lzwGap)} (${(lzwGap / totalGap * 100).toFixed(0)}% of gap)`);
      console.log(`    LCT palette overhead: +${formatSize(lctGap)} (${(lctGap / totalGap * 100).toFixed(0)}% of gap)`);
      console.log(`    Other (headers/ext):  +${formatSize(otherGap)} (${(otherGap / totalGap * 100).toFixed(0)}% of gap)`);

      // Per-frame comparison for first 10
      console.log(`\n  Per-frame comparison (frames 1-9):`);
      console.log(`  Frame | gk LZW   | gh LZW   | gk Trans% | gh Trans% | gk LCT | gh LCT`);
      console.log(`  ------|----------|----------|-----------|-----------|--------|------`);
      for (let fi = 1; fi < Math.min(10, Math.min(gifFrames.length, gkFrames.length)); fi++) {
        const gk = gkFrames[fi];
        const gh = gifFrames[fi];
        const gkTotal = gk.opaquePixels + gk.transparentPixels;
        const ghTotal = gh.opaquePixels + gh.transparentPixels;
        const gkTP = gkTotal > 0 ? ((gk.transparentPixels / gkTotal) * 100).toFixed(1) : "0.0";
        const ghTP = ghTotal > 0 ? ((gh.transparentPixels / ghTotal) * 100).toFixed(1) : "0.0";
        console.log(
          `  ${String(fi).padStart(5)} | ${`${gk.lzwBytes}B`.padEnd(8)} | ${`${gh.lzwBytes}B`.padEnd(8)} | ` +
          `${`${gkTP}%`.padEnd(9)} | ${`${ghTP}%`.padEnd(9)} | ${String(gk.lctSize).padEnd(6)} | ${gh.lctSize}`
        );
      }
    }
  }
}

async function main() {
  mkdirSync(TEMP_DIR, { recursive: true });
  console.log("=== Stale Fix Verification + Diagnosis ===");

  await verifyFixture("skin-tones");
  await verifyFixture("talking-head");
  await verifyFixture("big-buck-bunny");

  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
  console.log("\n=== Done ===");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
