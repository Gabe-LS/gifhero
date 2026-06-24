/**
 * Parameter sensitivity analysis for gifhero.
 *
 * Varies one encoding parameter at a time across three fixtures,
 * measures VMAF and file size, and outputs detailed results.
 *
 * Run: npx tsx test/bench/sensitivity.ts
 */

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  rmSync,
} from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { encode } from "../../src/index.js";
import type { EncodeOptions } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");
const RESULTS_DIR = join(__dirname, "results");
const REFS_DIR = join(__dirname, "references");
const SENSITIVITY_DIR = join(__dirname, "sensitivity");
const TEMP_DIR = join(__dirname, ".tmp-sensitivity");

const TARGET_FIXTURES = ["skin-tones", "talking-head", "big-buck-bunny"];

// ── Types ───────────────────────────────────────────────────────

interface FrameData {
  data: Uint8ClampedArray;
  delay: number;
}

interface LoadedFixture {
  name: string;
  width: number;
  height: number;
  frames: FrameData[];
}

interface GifFrameInfo {
  index: number;
  width: number;
  height: number;
  left: number;
  top: number;
  localColorTableSize: number;
  hasLocalColorTable: boolean;
  disposalMethod: number;
  hasTransparency: boolean;
  transparentIndex: number;
  lzwDataSize: number;
  opaquePixels: number;
  transparentPixels: number;
}

interface GifStructure {
  width: number;
  height: number;
  hasGlobalColorTable: boolean;
  globalColorTableSize: number;
  frames: GifFrameInfo[];
  totalSize: number;
}

interface SweepResult {
  value: number | string | boolean;
  vmaf: number | null;
  size: number;
  encodingTimeMs: number;
  extras: Record<string, number | string | null>;
}

interface SweepSeries {
  fixture: string;
  parameter: string;
  baseline: Record<string, unknown>;
  results: SweepResult[];
}

// ── Utility ─────────────────────────────────────────────────────

function loadPngFrames(dir: string): LoadedFixture {
  const files = readdirSync(dir).filter(f => f.endsWith(".png")).sort();
  let width = 0, height = 0;
  const frames: FrameData[] = [];
  for (const file of files) {
    const img = new Image();
    img.src = readFileSync(join(dir, file));
    if (width === 0) { width = img.width; height = img.height; }
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    frames.push({ data: ctx.getImageData(0, 0, img.width, img.height).data, delay: 50 });
  }
  return { name: basename(dir), width, height, frames };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function hasVmafSupport(): boolean {
  try {
    const output = execSync("ffmpeg -filters 2>&1", { encoding: "utf-8", timeout: 10000 });
    return output.includes("libvmaf");
  } catch {
    return false;
  }
}

function extractGifFrames(gifPath: string, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  execSync(`ffmpeg -y -i "${gifPath}" -vsync 0 "${outDir}/%04d.png"`, {
    stdio: "ignore", timeout: 60000,
  });
  return outDir;
}

function computeVmaf(
  sourceDir: string,
  gifPath: string,
  width: number,
  height: number,
): number | null {
  const logDir = join(TEMP_DIR, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${basename(gifPath, ".gif")}-vmaf.json`);

  const cmd =
    `ffmpeg -y -framerate 20 -i "${sourceDir}/%04d.png" -i "${gifPath}" ` +
    `-filter_complex "` +
    `[1:v]scale=${width}:${height}:flags=bicubic[dist];` +
    `[0:v][dist]libvmaf=log_path=${logPath}:log_fmt=json` +
    `" -f null - 2>&1`;

  try {
    execSync(cmd, { encoding: "utf-8", timeout: 300000 });
    const data = JSON.parse(readFileSync(logPath, "utf-8"));
    return data.pooled_metrics?.vmaf?.mean ?? null;
  } catch {
    return null;
  }
}

// ── GIF Binary Parser ───────────────────────────────────────────

function parseGifStructure(data: Uint8Array): GifStructure {
  let pos = 0;
  const read = (n: number) => { const s = data.subarray(pos, pos + n); pos += n; return s; };
  const readByte = () => data[pos++];
  const readU16 = () => { const v = data[pos] | (data[pos + 1] << 8); pos += 2; return v; };

  // Header
  const sig = String.fromCharCode(...read(6));
  if (sig !== "GIF89a" && sig !== "GIF87a") throw new Error(`Not a GIF: ${sig}`);

  // Logical Screen Descriptor
  const screenW = readU16();
  const screenH = readU16();
  const packed = readByte();
  const hasGCT = !!(packed & 0x80);
  const gctSizeField = packed & 0x07;
  const gctSize = hasGCT ? 3 * (1 << (gctSizeField + 1)) : 0;
  readByte(); // bg color index
  readByte(); // pixel aspect ratio

  if (hasGCT) pos += gctSize;

  const frames: GifFrameInfo[] = [];
  let pendingDisposal = 0;
  let pendingTransparency = false;
  let pendingTransIdx = 0;
  let frameIdx = 0;

  while (pos < data.length) {
    const block = readByte();
    if (block === 0x3b) break; // trailer

    if (block === 0x21) {
      // Extension
      const label = readByte();
      if (label === 0xf9) {
        // Graphic Control Extension
        const bsize = readByte(); // 4
        const gcPacked = readByte();
        readU16(); // delay
        const transIdx = readByte();
        readByte(); // terminator
        pendingDisposal = (gcPacked >> 2) & 0x07;
        pendingTransparency = !!(gcPacked & 0x01);
        pendingTransIdx = transIdx;
      } else {
        // Skip sub-blocks
        while (true) {
          const sz = readByte();
          if (sz === 0) break;
          pos += sz;
        }
      }
      continue;
    }

    if (block === 0x2c) {
      // Image Descriptor
      const left = readU16();
      const top = readU16();
      const imgW = readU16();
      const imgH = readU16();
      const imgPacked = readByte();
      const hasLCT = !!(imgPacked & 0x80);
      const lctSizeField = imgPacked & 0x07;
      const lctEntries = hasLCT ? (1 << (lctSizeField + 1)) : 0;

      if (hasLCT) pos += lctEntries * 3;

      // LZW data
      const lzwMinCode = readByte();
      const lzwStart = pos;
      while (true) {
        const sz = readByte();
        if (sz === 0) break;
        pos += sz;
      }
      const lzwDataSize = pos - lzwStart;

      // Count transparent vs opaque pixels by decoding would be expensive;
      // we'll estimate from the metadata instead
      const totalPixels = imgW * imgH;

      frames.push({
        index: frameIdx++,
        width: imgW,
        height: imgH,
        left,
        top,
        localColorTableSize: lctEntries,
        hasLocalColorTable: hasLCT,
        disposalMethod: pendingDisposal,
        hasTransparency: pendingTransparency,
        transparentIndex: pendingTransparency ? pendingTransIdx : -1,
        lzwDataSize,
        opaquePixels: totalPixels, // placeholder
        transparentPixels: 0,      // placeholder
      });

      pendingDisposal = 0;
      pendingTransparency = false;
      pendingTransIdx = 0;
      continue;
    }

    // Unknown block — skip sub-blocks
    while (pos < data.length) {
      const sz = readByte();
      if (sz === 0) break;
      pos += sz;
    }
  }

  return {
    width: screenW,
    height: screenH,
    hasGlobalColorTable: hasGCT,
    globalColorTableSize: hasGCT ? (1 << (gctSizeField + 1)) : 0,
    frames,
    totalSize: data.length,
  };
}

// ── Concurrency helpers ─────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Encoding + measurement ──────────────────────────────────────

async function encodeAndMeasure(
  fixture: LoadedFixture,
  options: Partial<EncodeOptions>,
  label: string,
  vmafAvail: boolean,
): Promise<{ vmaf: number | null; size: number; timeMs: number; gifPath: string }> {
  const gifsDir = join(SENSITIVITY_DIR);
  mkdirSync(gifsDir, { recursive: true });

  const gifPath = join(gifsDir, `${label}.gif`);

  const encodeOpts: EncodeOptions = {
    width: fixture.width,
    height: fixture.height,
    frames: fixture.frames,
    preset: "balanced",
    ...options,
  };

  const start = performance.now();
  const gif = await encode(encodeOpts);
  const timeMs = Math.round(performance.now() - start);
  writeFileSync(gifPath, gif);
  const size = gif.length;

  let vmaf: number | null = null;
  if (vmafAvail) {
    const sourceDir = join(FIXTURES_DIR, fixture.name);
    const extractDir = join(TEMP_DIR, "frames", label);
    try {
      extractGifFrames(gifPath, extractDir);
      vmaf = computeVmaf(sourceDir, gifPath, fixture.width, fixture.height);
    } catch {}
  }

  return { vmaf, size, timeMs, gifPath };
}

// ── Step 1: GIF structure analysis ──────────────────────────────

function step1_gifStructureAnalysis(fixtures: string[]): string {
  console.log("\n=== Step 1: GIF Binary Structure Analysis ===\n");
  let report = "# GIF Binary Structure Analysis\n\n";

  for (const fixtureName of fixtures) {
    const gifskiPath = join(REFS_DIR, `${fixtureName}-gifski.gif`);
    const gifheroPath = join(REFS_DIR, `${fixtureName}-gifhero-balanced.gif`);

    if (!existsSync(gifskiPath) || !existsSync(gifheroPath)) {
      console.log(`  Skipping ${fixtureName}: reference GIFs not found`);
      continue;
    }

    const gifskiData = readFileSync(gifskiPath);
    const gifheroData = readFileSync(gifheroPath);
    const gifskiStruct = parseGifStructure(new Uint8Array(gifskiData));
    const gifheroStruct = parseGifStructure(new Uint8Array(gifheroData));

    report += `## ${fixtureName}\n\n`;
    report += `| Property | gifski | gifhero |\n`;
    report += `|----------|--------|----------|\n`;
    report += `| File size | ${formatSize(gifskiStruct.totalSize)} | ${formatSize(gifheroStruct.totalSize)} |\n`;
    report += `| Canvas | ${gifskiStruct.width}×${gifskiStruct.height} | ${gifheroStruct.width}×${gifheroStruct.height} |\n`;
    report += `| Global palette | ${gifskiStruct.hasGlobalColorTable ? gifskiStruct.globalColorTableSize + " colors" : "none"} | ${gifheroStruct.hasGlobalColorTable ? gifheroStruct.globalColorTableSize + " colors" : "none"} |\n`;
    report += `| Frame count | ${gifskiStruct.frames.length} | ${gifheroStruct.frames.length} |\n\n`;

    // Per-frame comparison (first 10 + last 5)
    const maxFrames = Math.max(gifskiStruct.frames.length, gifheroStruct.frames.length);
    const showFrames = maxFrames <= 20 ? Array.from({ length: maxFrames }, (_, i) => i)
      : [...Array.from({ length: 10 }, (_, i) => i), ...Array.from({ length: 5 }, (_, i) => maxFrames - 5 + i)];

    report += `| Frame | gifski dims | gifski offset | gifski LCT | gifski LZW | gifhero dims | gifhero offset | gifhero LCT | gifhero LZW | gifski disp | gifhero disp | gifski trans | gifhero trans |\n`;
    report += `|-------|-------------|---------------|------------|------------|--------------|----------------|-------------|-------------|-------------|--------------|--------------|---------------|\n`;

    for (const fi of showFrames) {
      const gk = gifskiStruct.frames[fi];
      const gh = gifheroStruct.frames[fi];
      if (!gk && !gh) continue;
      const gkDims = gk ? `${gk.width}×${gk.height}` : "-";
      const gkOff = gk ? `${gk.left},${gk.top}` : "-";
      const gkLCT = gk ? (gk.hasLocalColorTable ? gk.localColorTableSize.toString() : "GCT") : "-";
      const gkLZW = gk ? `${gk.lzwDataSize}B` : "-";
      const ghDims = gh ? `${gh.width}×${gh.height}` : "-";
      const ghOff = gh ? `${gh.left},${gh.top}` : "-";
      const ghLCT = gh ? (gh.hasLocalColorTable ? gh.localColorTableSize.toString() : "GCT") : "-";
      const ghLZW = gh ? `${gh.lzwDataSize}B` : "-";
      const gkDisp = gk ? gk.disposalMethod.toString() : "-";
      const ghDisp = gh ? gh.disposalMethod.toString() : "-";
      const gkTrans = gk ? (gk.hasTransparency ? `idx ${gk.transparentIndex}` : "no") : "-";
      const ghTrans = gh ? (gh.hasTransparency ? `idx ${gh.transparentIndex}` : "no") : "-";
      report += `| ${fi} | ${gkDims} | ${gkOff} | ${gkLCT} | ${gkLZW} | ${ghDims} | ${ghOff} | ${ghLCT} | ${ghLZW} | ${gkDisp} | ${ghDisp} | ${gkTrans} | ${ghTrans} |\n`;
    }

    // Summary stats
    const gkAvgLZW = gifskiStruct.frames.reduce((s, f) => s + f.lzwDataSize, 0) / gifskiStruct.frames.length;
    const ghAvgLZW = gifheroStruct.frames.reduce((s, f) => s + f.lzwDataSize, 0) / gifheroStruct.frames.length;
    const gkSubframes = gifskiStruct.frames.filter(f => f.width < gifskiStruct.width || f.height < gifskiStruct.height).length;
    const ghSubframes = gifheroStruct.frames.filter(f => f.width < gifheroStruct.width || f.height < gifheroStruct.height).length;
    const gkTransFrames = gifskiStruct.frames.filter(f => f.hasTransparency).length;
    const ghTransFrames = gifheroStruct.frames.filter(f => f.hasTransparency).length;
    const gkLocalPals = gifskiStruct.frames.filter(f => f.hasLocalColorTable).length;
    const ghLocalPals = gifheroStruct.frames.filter(f => f.hasLocalColorTable).length;

    report += `\n**Summary:**\n`;
    report += `- gifski: ${gkSubframes}/${gifskiStruct.frames.length} sub-framed, ${gkTransFrames} with transparency, ${gkLocalPals} local palettes, avg LZW ${Math.round(gkAvgLZW)}B/frame\n`;
    report += `- gifhero: ${ghSubframes}/${gifheroStruct.frames.length} sub-framed, ${ghTransFrames} with transparency, ${ghLocalPals} local palettes, avg LZW ${Math.round(ghAvgLZW)}B/frame\n\n`;

    // Console output
    console.log(`  ${fixtureName}:`);
    console.log(`    gifski:  ${formatSize(gifskiStruct.totalSize)}, ${gkSubframes} sub-frames, ${gkTransFrames} transparent, avg LZW ${Math.round(gkAvgLZW)}B`);
    console.log(`    gifhero: ${formatSize(gifheroStruct.totalSize)}, ${ghSubframes} sub-frames, ${ghTransFrames} transparent, avg LZW ${Math.round(ghAvgLZW)}B`);
  }

  return report;
}

// ── Step 2: Parameter sweeps ────────────────────────────────────

interface SweepConfig {
  parameter: string;
  values: Array<number | string | boolean>;
  buildOptions: (value: number | string | boolean) => Partial<EncodeOptions>;
  extraMetrics?: string[];
}

function defineSweeps(): SweepConfig[] {
  return [
    {
      parameter: "cropTolerance",
      values: [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20],
      buildOptions: (v) => ({
        optimize: { subframe: true, cropTolerance: v as number, holeTolerance: 0, transparencyEqualization: true },
      }),
    },
    {
      parameter: "holeTolerance",
      values: [0, 1, 2, 3, 5],
      buildOptions: (v) => ({
        optimize: { subframe: true, cropTolerance: 5, holeTolerance: v as number, transparencyEqualization: true },
      }),
    },
    {
      parameter: "quantizerQuality",
      values: [40, 50, 60, 70, 80, 90, 100],
      buildOptions: (v) => ({
        imagequantQuality: v as number,
        optimize: { subframe: true, cropTolerance: 5, holeTolerance: 0, transparencyEqualization: true },
      }),
    },
    {
      parameter: "quantizerSpeed",
      values: [1, 2, 3, 4, 6, 8, 10],
      buildOptions: (v) => ({
        imagequantSpeed: v as number,
        optimize: { subframe: true, cropTolerance: 5, holeTolerance: 0, transparencyEqualization: true },
      }),
    },
    {
      parameter: "lossyLzw",
      values: [0, 2, 4, 6, 8, 10, 15, 20],
      buildOptions: (v) => ({
        lossyLzw: v as number,
        optimize: { subframe: true, cropTolerance: 5, holeTolerance: 0, transparencyEqualization: true },
      }),
    },
    {
      parameter: "maxColors",
      values: [16, 32, 64, 128, 192, 256],
      buildOptions: (v) => ({
        maxColors: v as number,
        optimize: { subframe: true, cropTolerance: 5, holeTolerance: 0, transparencyEqualization: true },
      }),
    },
    {
      parameter: "temporalWeight",
      values: [0, 0.1, 0.2, 0.3, 0.5, 0.7],
      buildOptions: (v) => ({
        temporalDither: (v as number) > 0,
        temporalWeight: v as number,
        optimize: { subframe: true, cropTolerance: 5, holeTolerance: 0, transparencyEqualization: true },
      }),
    },
    {
      parameter: "palette",
      values: ["local", "crossframe", "adaptive", "global"],
      buildOptions: (v) => ({
        palette: v as "local" | "crossframe" | "adaptive" | "global",
        optimize: { subframe: true, cropTolerance: 5, holeTolerance: 0, transparencyEqualization: true },
      }),
    },
    {
      parameter: "staleThreshold",
      values: [1, 2, 3, 5, 8, 10],
      buildOptions: (v) => ({
        optimize: {
          subframe: true, cropTolerance: 5, holeTolerance: 0,
          transparencyEqualization: true, staleThreshold: v as number,
        },
      }),
    },
    {
      parameter: "transparencyEqualization",
      values: ["off", "neighbors-4", "neighbors-6", "neighbors-8"],
      buildOptions: (v) => {
        if (v === "off") {
          return {
            optimize: { subframe: true, cropTolerance: 5, holeTolerance: 0, transparencyEqualization: false },
          };
        }
        const thresh = parseInt((v as string).split("-")[1]);
        return {
          optimize: {
            subframe: true, cropTolerance: 5, holeTolerance: 0,
            transparencyEqualization: true, transeqNeighborThreshold: thresh,
          },
        };
      },
    },
  ];
}

// ── Main sweep runner ───────────────────────────────────────────

async function runSweeps(
  fixtures: LoadedFixture[],
  sweeps: SweepConfig[],
  vmafAvail: boolean,
  concurrency: number,
): Promise<SweepSeries[]> {
  const allSeries: SweepSeries[] = [];

  // Build all tasks
  interface SweepTask {
    fixture: LoadedFixture;
    sweep: SweepConfig;
    value: number | string | boolean;
    label: string;
  }

  const tasks: SweepTask[] = [];
  for (const fixture of fixtures) {
    for (const sweep of sweeps) {
      for (const value of sweep.values) {
        const label = `${fixture.name}-${sweep.parameter}-${value}`;
        tasks.push({ fixture, sweep, value, label });
      }
    }
  }

  console.log(`\n=== Step 2: Parameter Sensitivity Sweeps ===`);
  console.log(`Total encodes: ${tasks.length} (${fixtures.length} fixtures × ${sweeps.length} parameters)`);
  console.log(`Concurrency: ${concurrency}\n`);

  // Results storage
  const resultMap = new Map<string, SweepResult>();
  let completed = 0;
  const startTime = performance.now();

  const taskFns = tasks.map((task) => async () => {
    const { fixture, sweep, value, label } = task;
    const options = sweep.buildOptions(value);

    try {
      const result = await encodeAndMeasure(fixture, options, label, vmafAvail);
      const sweepResult: SweepResult = {
        value,
        vmaf: result.vmaf,
        size: result.size,
        encodingTimeMs: result.timeMs,
        extras: {},
      };
      resultMap.set(`${fixture.name}|${sweep.parameter}|${value}`, sweepResult);
      completed++;

      const elapsed = (performance.now() - startTime) / 1000;
      const rate = completed / elapsed;
      const remaining = (tasks.length - completed) / rate;
      process.stdout.write(
        `\r  [${completed}/${tasks.length}] ${label} done (${result.timeMs}ms, ${formatSize(result.size)}) — ETA ${Math.round(remaining)}s   `
      );
    } catch (err) {
      completed++;
      console.error(`\n  ✗ ${label} failed: ${(err as Error).message}`);
    }
  });

  await runWithConcurrency(taskFns, concurrency);
  console.log("\n");

  // Organize results into series
  for (const fixture of fixtures) {
    for (const sweep of sweeps) {
      const results: SweepResult[] = [];
      for (const value of sweep.values) {
        const key = `${fixture.name}|${sweep.parameter}|${value}`;
        const r = resultMap.get(key);
        if (r) results.push(r);
      }
      allSeries.push({
        fixture: fixture.name,
        parameter: sweep.parameter,
        baseline: { preset: "balanced", imagequantQuality: 80, imagequantSpeed: 3, maxColors: 256, lossyLzw: 4, cropTolerance: 5, holeTolerance: 0 },
        results,
      });
    }
  }

  return allSeries;
}

// ── Parallelization validation ──────────────────────────────────

async function validateParallelism(
  fixture: LoadedFixture,
  vmafAvail: boolean,
): Promise<void> {
  console.log("\n=== Parallelization Validation ===\n");

  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 20, 25, 30];

  interface ValResult { value: number; vmaf: number | null; size: number }

  // Sequential
  console.log("  Running 16 encodes sequentially...");
  const seqStart = performance.now();
  const seqResults: ValResult[] = [];
  for (const v of values) {
    const label = `validation-seq-cropTolerance-${v}`;
    const r = await encodeAndMeasure(fixture, {
      optimize: { subframe: true, cropTolerance: v, holeTolerance: 0, transparencyEqualization: true },
    }, label, vmafAvail);
    seqResults.push({ value: v, vmaf: r.vmaf, size: r.size });
  }
  const seqTime = (performance.now() - seqStart) / 1000;

  // Parallel
  console.log("  Running 16 encodes in parallel...");
  const parStart = performance.now();
  const parTasks = values.map((v) => async () => {
    const label = `validation-par-cropTolerance-${v}`;
    const r = await encodeAndMeasure(fixture, {
      optimize: { subframe: true, cropTolerance: v, holeTolerance: 0, transparencyEqualization: true },
    }, label, vmafAvail);
    return { value: v, vmaf: r.vmaf, size: r.size } as ValResult;
  });
  const parResults = await Promise.all(parTasks.map(t => t()));
  const parTime = (performance.now() - parStart) / 1000;

  const speedup = seqTime / parTime;

  console.log(`\n  Sequential total: ${seqTime.toFixed(1)}s`);
  console.log(`  Parallel total:   ${parTime.toFixed(1)}s`);
  console.log(`  Speedup:          ${speedup.toFixed(1)}×\n`);

  console.log("  cropTolerance | Seq VMAF | Par VMAF | Seq Size  | Par Size  | Match?");
  console.log("  --------------|----------|----------|-----------|-----------|-------");

  let allMatch = true;
  for (let i = 0; i < values.length; i++) {
    const s = seqResults[i];
    const p = parResults.find(r => r.value === values[i])!;
    const sizeMatch = s.size === p.size;
    const vmafMatch = s.vmaf === p.vmaf || (s.vmaf !== null && p.vmaf !== null && Math.abs(s.vmaf - p.vmaf) < 0.01);
    const match = sizeMatch && vmafMatch;
    if (!match) allMatch = false;
    console.log(
      `  ${String(values[i]).padStart(13)} | ${s.vmaf?.toFixed(1).padStart(8) ?? "   N/A  "} | ${p.vmaf?.toFixed(1).padStart(8) ?? "   N/A  "} | ${formatSize(s.size).padStart(9)} | ${formatSize(p.size).padStart(9)} | ${match ? "✅" : "❌"}`
    );
  }

  if (allMatch) {
    console.log(`\n  ✅ All rows match. Parallel encoding produces identical results.`);
  } else {
    console.log(`\n  ⚠ Some rows differ. Size differences may indicate non-determinism.`);
  }

  if (speedup < 4) {
    console.log(`  ⚠ Speedup is only ${speedup.toFixed(1)}× — WASM may serialize internally.`);
  }
}

// ── Output formatting ───────────────────────────────────────────

function printSweepTable(series: SweepSeries): string {
  const { fixture, parameter, results } = series;
  let out = `\n=== ${parameter} on ${fixture} ===\n`;
  out += "Value".padEnd(20) + " | " + "VMAF".padStart(6) + " | " + "Size".padStart(8) + " | " + "Time(ms)".padStart(8) + "\n";
  out += "-".repeat(20) + "-|-" + "-".repeat(6) + "-|-" + "-".repeat(8) + "-|-" + "-".repeat(8) + "\n";

  for (const r of results) {
    const val = String(r.value).padEnd(20);
    const vmaf = r.vmaf !== null ? r.vmaf.toFixed(1).padStart(6) : "  N/A ".padStart(6);
    const size = formatSize(r.size).padStart(8);
    const time = String(r.encodingTimeMs).padStart(8);
    out += `${val} | ${vmaf} | ${size} | ${time}\n`;
  }

  return out;
}

function asciiChart(label: string, values: Array<{ x: string; y: number }>): string {
  if (values.length === 0) return "";
  const maxY = Math.max(...values.map(v => v.y));
  const minY = Math.min(...values.map(v => v.y));
  const barWidth = 40;

  let out = `${label}:\n`;
  for (const v of values) {
    const norm = maxY > minY ? (v.y - minY) / (maxY - minY) : 1;
    const bars = Math.round(norm * barWidth);
    const yStr = typeof v.y === "number" && v.y > 1000 ? formatSize(v.y) : v.y.toFixed(1);
    out += `  ${yStr.padStart(8)} |${"█".repeat(bars)}${"░".repeat(barWidth - bars)}| ${v.x}\n`;
  }
  return out;
}

function findOptimalVmafPerMB(results: SweepResult[]): { value: number | string | boolean; vmafPerMB: number } | null {
  let best: { value: number | string | boolean; vmafPerMB: number } | null = null;
  for (const r of results) {
    if (r.vmaf === null || r.size === 0) continue;
    const vmafPerMB = r.vmaf / (r.size / (1024 * 1024));
    if (!best || vmafPerMB > best.vmafPerMB) {
      best = { value: r.value, vmafPerMB };
    }
  }
  return best;
}

// ── Report generation ───────────────────────────────────────────

function generateReport(
  structureReport: string,
  allSeries: SweepSeries[],
  fixtures: string[],
): string {
  let md = "# Parameter Sensitivity Analysis Report\n\n";
  md += `Generated: ${new Date().toISOString()}\n\n`;

  // 7a: Structure analysis
  md += structureReport + "\n";

  // 7b: Parameter sensitivity tables
  md += "---\n\n# Parameter Sensitivity Results\n\n";

  const sweepNames = [...new Set(allSeries.map(s => s.parameter))];

  for (const param of sweepNames) {
    md += `## ${param}\n\n`;

    for (const fixture of fixtures) {
      const series = allSeries.find(s => s.parameter === param && s.fixture === fixture);
      if (!series || series.results.length === 0) continue;

      md += `### ${fixture}\n\n`;
      md += `| Value | VMAF | Size | Time (ms) |\n`;
      md += `|-------|------|------|----------|\n`;

      for (const r of series.results) {
        md += `| ${r.value} | ${r.vmaf?.toFixed(2) ?? "N/A"} | ${formatSize(r.size)} | ${r.encodingTimeMs} |\n`;
      }
      md += "\n";

      // ASCII charts
      if (series.results.some(r => r.vmaf !== null)) {
        md += "```\n";
        md += asciiChart(`VMAF (${fixture})`, series.results
          .filter(r => r.vmaf !== null)
          .map(r => ({ x: String(r.value), y: r.vmaf! })));
        md += "\n";
        md += asciiChart(`Size (${fixture})`, series.results
          .map(r => ({ x: String(r.value), y: r.size })));
        md += "```\n\n";
      }
    }
  }

  // 7d: Optimal values
  md += "---\n\n# Optimal Values (max VMAF/MB)\n\n";
  md += `| Parameter | ${fixtures.join(" | ")} |\n`;
  md += `|-----------|${fixtures.map(() => "---").join("|")}|\n`;

  for (const param of sweepNames) {
    const row = [param];
    for (const fixture of fixtures) {
      const series = allSeries.find(s => s.parameter === param && s.fixture === fixture);
      if (!series) { row.push("-"); continue; }
      const optimal = findOptimalVmafPerMB(series.results);
      row.push(optimal ? String(optimal.value) : "-");
    }
    md += `| ${row.join(" | ")} |\n`;
  }

  md += "\n";

  // 7e: Key findings
  md += "---\n\n# Key Findings\n\n";
  md += "## File Size Leverage\n\n";

  // Find which parameters have the highest size range
  const sizeRanges: Array<{ param: string; fixture: string; range: number; min: number; max: number }> = [];
  for (const series of allSeries) {
    if (series.results.length < 2) continue;
    const sizes = series.results.map(r => r.size);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    sizeRanges.push({ param: series.parameter, fixture: series.fixture, range: (max - min) / min * 100, min, max });
  }
  sizeRanges.sort((a, b) => b.range - a.range);

  md += `| Parameter | Fixture | Min Size | Max Size | Range (%) |\n`;
  md += `|-----------|---------|----------|----------|----------|\n`;
  for (const sr of sizeRanges.slice(0, 15)) {
    md += `| ${sr.param} | ${sr.fixture} | ${formatSize(sr.min)} | ${formatSize(sr.max)} | ${sr.range.toFixed(0)}% |\n`;
  }
  md += "\n";

  // VMAF leverage
  md += "## VMAF Leverage\n\n";
  const vmafRanges: Array<{ param: string; fixture: string; range: number; min: number; max: number }> = [];
  for (const series of allSeries) {
    const vmafs = series.results.filter(r => r.vmaf !== null).map(r => r.vmaf!);
    if (vmafs.length < 2) continue;
    const min = Math.min(...vmafs);
    const max = Math.max(...vmafs);
    vmafRanges.push({ param: series.parameter, fixture: series.fixture, range: max - min, min, max });
  }
  vmafRanges.sort((a, b) => b.range - a.range);

  md += `| Parameter | Fixture | Min VMAF | Max VMAF | Range |\n`;
  md += `|-----------|---------|----------|----------|-------|\n`;
  for (const vr of vmafRanges.slice(0, 15)) {
    md += `| ${vr.param} | ${vr.fixture} | ${vr.min.toFixed(2)} | ${vr.max.toFixed(2)} | ${vr.range.toFixed(2)} |\n`;
  }
  md += "\n";

  // Content divergence
  md += "## Content-Type Divergence\n\n";
  md += "Parameters where optimal value differs across fixtures are candidates for content-adaptive logic:\n\n";

  for (const param of sweepNames) {
    const optVals: string[] = [];
    for (const fixture of fixtures) {
      const series = allSeries.find(s => s.parameter === param && s.fixture === fixture);
      if (!series) continue;
      const opt = findOptimalVmafPerMB(series.results);
      optVals.push(opt ? String(opt.value) : "-");
    }
    const unique = new Set(optVals.filter(v => v !== "-"));
    if (unique.size > 1) {
      md += `- **${param}**: ${fixtures.map((f, i) => `${f}=${optVals[i]}`).join(", ")}\n`;
    }
  }
  md += "\n";

  // 7f: Comparison with gifski
  md += "---\n\n# Comparison with gifski\n\n";
  md += "(See structure analysis above for per-frame comparison. Best gifhero config vs gifski comparison requires the full benchmark data.)\n\n";

  return md;
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("=== gifhero Parameter Sensitivity Analysis ===\n");

  // Setup
  mkdirSync(SENSITIVITY_DIR, { recursive: true });
  mkdirSync(TEMP_DIR, { recursive: true });

  const vmafAvail = hasVmafSupport();
  console.log(`VMAF support: ${vmafAvail ? "yes" : "NO — install ffmpeg with libvmaf"}`);

  // Check CPU count for concurrency
  const cpuCount = parseInt(execSync("sysctl -n hw.ncpu", { encoding: "utf-8" }).trim()) || 8;
  const concurrency = Math.min(16, cpuCount);
  console.log(`CPU cores: ${cpuCount}, concurrency: ${concurrency}`);

  // Load fixtures
  console.log("\nLoading fixtures...");
  const fixtures: LoadedFixture[] = [];
  for (const name of TARGET_FIXTURES) {
    const dir = join(FIXTURES_DIR, name);
    if (!existsSync(dir)) {
      console.log(`  ⚠ Fixture ${name} not found, skipping`);
      continue;
    }
    const f = loadPngFrames(dir);
    console.log(`  ${name}: ${f.width}×${f.height}, ${f.frames.length} frames`);
    fixtures.push(f);
  }

  if (fixtures.length === 0) {
    console.error("No fixtures found. Run `npm run fixtures` first.");
    process.exit(1);
  }

  // Step 1: GIF structure analysis
  const structureReport = step1_gifStructureAnalysis(TARGET_FIXTURES);

  // Parallelization validation
  await validateParallelism(fixtures[0], vmafAvail);

  // Step 2: Parameter sweeps
  const sweeps = defineSweeps();
  const allSeries = await runSweeps(fixtures, sweeps, vmafAvail, concurrency);

  // Print tables to console
  for (const series of allSeries) {
    console.log(printSweepTable(series));
  }

  // Step 4: Save JSON results
  const jsonPath = join(RESULTS_DIR, "sensitivity-analysis.json");
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(allSeries, null, 2));
  console.log(`\nJSON results saved to ${jsonPath}`);

  // Step 5: Optimal values summary
  console.log("\n=== Optimal Values (max VMAF/MB) ===\n");
  const sweepNames = [...new Set(allSeries.map(s => s.parameter))];
  const fixNames = fixtures.map(f => f.name);

  const header = "Parameter".padEnd(25) + " | " + fixNames.map(f => f.padStart(16)).join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const param of sweepNames) {
    const row = [param.padEnd(25)];
    for (const fname of fixNames) {
      const series = allSeries.find(s => s.parameter === param && s.fixture === fname);
      const opt = series ? findOptimalVmafPerMB(series.results) : null;
      row.push((opt ? String(opt.value) : "-").padStart(16));
    }
    console.log(row.join(" | "));
  }

  // Step 7: Generate MD report
  const report = generateReport(structureReport, allSeries, fixNames);
  const reportPath = join(__dirname, "sensitivity-report.md");
  writeFileSync(reportPath, report);
  console.log(`\nReport saved to ${reportPath}`);

  // Cleanup temp
  try {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {}

  console.log("\n=== Done ===");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
