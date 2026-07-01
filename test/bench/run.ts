/**
 * gifhero benchmark runner.
 *
 * Usage:
 *   npx tsx test/bench/run.ts [options]
 *
 * Options:
 *   --fixtures <names>      Comma-separated fixture names [default: all]
 *   --resolutions <widths>  Comma-separated target widths [default: 480,360,240,160]
 *   --encoders <names>      Comma-separated encoder names [default: all]
 *   --metrics <names>       Comma-separated: vmaf,ssim,psnr,ciede,cambi,dssim,tfs [default: all]
 *   --out-dir <path>         Base output directory [default: test/bench/results]
 *   --list                  List available fixtures and encoders, then exit
 *   --parallel              Encode gifhero variants in parallel via worker threads
 *   --fast                  Fast mode: 6 fixtures, gifhero+gifski only, skip DSSIM/TFS
 *
 * Examples:
 *   npx tsx test/bench/run.ts --fixtures bbb-clip-01,candle-flame --encoders gifhero,gifski
 *   npx tsx test/bench/run.ts --resolutions 480,360,240 --metrics vmaf,ssim
 *   npx tsx test/bench/run.ts --parallel --resolutions 480,360,240,160
 */

import { exec, execSync } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
import { createHash } from "crypto";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync,
} from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { isDssimAvailable, dssimFrames, extractGifFrames } from "../metrics/dssim.js";
import { computeFlickerScore } from "../metrics/flicker.js";
import { encode } from "../../src/index.js";
import { encodeParallel } from "./parallel.js";
import type { EncodeJob } from "./parallel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");

const FAST_FIXTURES = new Set([
  "big-buck-bunny", "jellyfish", "candle-flame", "screencast", "talking-head", "skin-tones",
]);

function fileHash(path: string): string {
  return createHash("blake2b512").update(readFileSync(path)).digest("hex").slice(0, 32);
}

function bufHash(buf: Uint8Array): string {
  return createHash("blake2b512").update(buf).digest("hex").slice(0, 32);
}

// ── CLI argument parsing ──

function parseArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function getAllFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter(name => {
      const dir = join(FIXTURES_DIR, name);
      return statSync(dir).isDirectory() && readdirSync(dir).filter(f => f.endsWith(".png")).length >= 2;
    })
    .sort();
}

// ── Tool detection ──

function hasCommand(cmd: string): boolean {
  try { execSync(`command -v ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; }
}
function hasVmafSupport(): boolean {
  try { return execSync("ffmpeg -filters 2>&1", { encoding: "utf-8", timeout: 10000 }).includes("libvmaf"); } catch { return false; }
}

// ── Frame loading ──

function loadPngFrames(dir: string, targetWidth?: number) {
  const files = readdirSync(dir).filter(f => f.endsWith(".png")).sort();
  let width = 0, height = 0;
  const frames: Array<{ data: Uint8ClampedArray; delay: number }> = [];
  for (const file of files) {
    const img = new Image();
    img.src = readFileSync(join(dir, file));
    if (!width) { width = img.width; height = img.height; }
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    frames.push({ data: ctx.getImageData(0, 0, img.width, img.height).data, delay: 50 });
  }
  return { width, height, frames };
}

// ── Encoder definitions ──

interface EncodeResult { timing?: Record<string, number> }
type EncoderFn = (framesDir: string, outputPath: string, targetWidth?: number) => EncodeResult | Promise<EncodeResult> | void | Promise<void>;

const ALL_ENCODERS: Record<string, { available: () => boolean; encode: EncoderFn }> = {
  "gifhero-wasm": {
    available: () => true,
    encode: async (framesDir, outputPath, targetWidth) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      const tw = targetWidth && targetWidth < width ? targetWidth : undefined;
      const timing: Record<string, number> = {};
      writeFileSync(outputPath, await encode({
        width, height, frames, preset: "balanced", timing,
        ...(tw ? { targetWidth: tw } : {}),
      }));
      return { timing };
    },
  },
  "gifhero": {
    available: () => {
      const bin = join(__dirname, "../../packages/gifhero-core/target/release/gifhero");
      try { return statSync(bin).isFile(); } catch { return false; }
    },
    encode: async (framesDir, outputPath, targetWidth) => {
      const bin = join(__dirname, "../../packages/gifhero-core/target/release/gifhero");
      const tmpVideo = outputPath + ".tmp.mkv";
      // Convert PNGs to lossless video so the CLI can process them
      await execAsync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -c:v ffv1 "${tmpVideo}"`,
        { timeout: 60000 },
      );
      const wFlag = targetWidth ? `-w ${targetWidth} ` : "";
      await execAsync(
        `"${bin}" "${tmpVideo}" ${wFlag}--fps 20 --preset balanced -o "${outputPath}" -q`,
        { timeout: 120000 },
      );
      try { rmSync(tmpVideo); } catch {}
    },
  },
  "gifski": {
    available: () => hasCommand("gifski"),
    encode: async (framesDir, outputPath, targetWidth) => {
      const wFlag = targetWidth ? `--width ${targetWidth} ` : "";
      await execAsync(`gifski --fps 20 ${wFlag}-o "${outputPath}" "${framesDir}"/*.png`,
        { timeout: 120000, shell: "/bin/bash" });
    },
  },
  "gifski-wasm": {
    available: () => { try { return !!import.meta.resolve("gifski-wasm"); } catch { return false; } },
    encode: async (framesDir, outputPath, targetWidth) => {
      const { init, encode: encodeGifski } = await import("gifski-wasm");
      const wasmBuf = readFileSync(join(dirname(fileURLToPath(import.meta.resolve("gifski-wasm"))), "..", "pkg", "gifski_wasm_bg.wasm"));
      await init(wasmBuf);
      const { width, height, frames: loadedFrames } = loadPngFrames(framesDir);
      const rawFrames: Uint8Array[] = loadedFrames.map(f =>
        new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength));
      const gif = await encodeGifski({
        frames: rawFrames, width, height, fps: 20, quality: 90,
        ...(targetWidth && targetWidth < width ? { resizeWidth: targetWidth } : {}),
      });
      writeFileSync(outputPath, gif);
    },
  },
  "ffmpeg": {
    available: () => hasCommand("ffmpeg"),
    encode: async (framesDir, outputPath, targetWidth) => {
      const scale = targetWidth ? `scale=${targetWidth}:-1:flags=lanczos,` : "";
      await execAsync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scale}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle" "${outputPath}"`,
        { timeout: 120000 });
    },
  },
  "ffmpeg-hq": {
    available: () => hasCommand("ffmpeg"),
    encode: async (framesDir, outputPath, targetWidth) => {
      const scale = targetWidth ? `scale=${targetWidth}:-1:flags=lanczos,` : "";
      await execAsync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scale}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=single[p];[s1][p]paletteuse=new=1:dither=floyd_steinberg:diff_mode=rectangle" "${outputPath}"`,
        { timeout: 120000 });
    },
  },
  "magick": {
    available: () => hasCommand("magick"),
    encode: async (framesDir, outputPath, targetWidth) => {
      const resize = targetWidth ? `-resize ${targetWidth}x` : "";
      await execAsync(
        `magick -delay 5 -loop 0 "${framesDir}/"*.png ${resize} -dither FloydSteinberg -colors 256 -coalesce -layers OptimizePlus -layers OptimizeTransparency "${outputPath}"`,
        { timeout: 120000, shell: "/bin/bash" });
    },
  },
  "ffmpeg+gifsicle": {
    available: () => hasCommand("ffmpeg") && hasCommand("gifsicle"),
    encode: async (framesDir, outputPath, targetWidth) => {
      const scale = targetWidth ? `scale=${targetWidth}:-1:flags=lanczos,` : "";
      const tmp = outputPath + ".tmp.gif";
      await execAsync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scale}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle" "${tmp}"`,
        { timeout: 120000 });
      await execAsync(`gifsicle -O3 --lossy=80 --color-method=median-cut "${tmp}" -o "${outputPath}"`,
        { timeout: 60000 });
      try { rmSync(tmp); } catch {}
    },
  },
};

// ── GIF inspection ──

interface GifInspection {
  frameCount: number;
  logicalWidth: number;
  logicalHeight: number;
  hasGlobalColorTable: boolean;
  globalColorTableSize: number;
  // Palette
  minPaletteSize: number;
  maxPaletteSize: number;
  avgPaletteSize: number;
  // Compression
  avgFrameCompressedBytes: number;
  minFrameCompressedBytes: number;
  maxFrameCompressedBytes: number;
  totalCompressedBytes: number;
  // Sub-framing
  fullFrameCount: number;
  subFrameCount: number;
  avgSubFrameCoverage: number;
  minSubFrameCoverage: number;
  // Transparency
  transparentFrameCount: number;
  // Timing
  delays: number[];           // all unique delay values in seconds
  avgDelay: number;
  minDelay: number;
  maxDelay: number;
  constantDelay: boolean;     // true if all frames have the same delay
  // Disposal
  disposalMethods: Record<string, number>;
  // Metadata
  loopCount: string;          // "forever", "none", or number
  comments: string[];
  interlaced: boolean;
  // Derived
  durationSeconds: number;
  effectiveFps: number;
  bitsPerPixel: number;       // totalCompressedBytes * 8 / (frameCount * w * h)
}

function parseGifsicleOutput(out: string, canvasW: number, canvasH: number): GifInspection {
  const lines = out.split("\n");
  let logicalWidth = 0, logicalHeight = 0;
  let hasGCT = false, gctSize = 0;
  let loopCount = "none";
  let interlaced = false;
  const comments: string[] = [];
  const paletteSizes: number[] = [];
  const compressedSizes: number[] = [];
  const frameDims: Array<{ w: number; h: number }> = [];
  const frameDelays: number[] = [];
  let transparentCount = 0;
  const disposals: Record<string, number> = {};

  for (const line of lines) {
    const lsMatch = line.match(/logical screen (\d+)x(\d+)/);
    if (lsMatch) { logicalWidth = +lsMatch[1]; logicalHeight = +lsMatch[2]; }
    const gctMatch = line.match(/global color table \[(\d+)\]/);
    if (gctMatch) { hasGCT = true; gctSize = +gctMatch[1]; }
    if (line.includes("loop forever")) loopCount = "forever";
    const loopMatch = line.match(/loop count (\d+)/);
    if (loopMatch) loopCount = loopMatch[1];
    const imgMatch = line.match(/image #\d+ (\d+)x(\d+)/);
    if (imgMatch) frameDims.push({ w: +imgMatch[1], h: +imgMatch[2] });
    const csMatch = line.match(/compressed size (\d+)/);
    if (csMatch) compressedSizes.push(+csMatch[1]);
    const lctMatch = line.match(/local color table \[(\d+)\]/);
    if (lctMatch) paletteSizes.push(+lctMatch[1]);
    if (line.includes("transparent")) transparentCount++;
    if (line.includes("interlaced")) interlaced = true;
    const delayMatch = line.match(/delay ([\d.]+)s/);
    if (delayMatch) frameDelays.push(parseFloat(delayMatch[1]));
    const dispMatch = line.match(/disposal (\w+)/);
    if (dispMatch) { const d = dispMatch[1]; disposals[d] = (disposals[d] || 0) + 1; }
    const commentMatch = line.match(/comment (.+)/);
    if (commentMatch) comments.push(commentMatch[1].trim());
  }

  const w = logicalWidth || canvasW;
  const h = logicalHeight || canvasH;
  const canvasPixels = w * h;
  const fullFrames = frameDims.filter(d => d.w * d.h >= canvasPixels * 0.95).length;
  const subFrames = frameDims.filter(d => d.w * d.h < canvasPixels * 0.95);
  const subCoverages = subFrames.map(d => (d.w * d.h) / canvasPixels);
  const avgCoverage = subCoverages.length > 0 ? subCoverages.reduce((s, c) => s + c, 0) / subCoverages.length : 0;
  const minCoverage = subCoverages.length > 0 ? Math.min(...subCoverages) : 0;
  const totalCompressed = compressedSizes.reduce((a, b) => a + b, 0);
  const totalDuration = frameDelays.reduce((a, b) => a + b, 0);
  const uniqueDelays = [...new Set(frameDelays)];

  return {
    frameCount: frameDims.length, logicalWidth: w, logicalHeight: h,
    hasGlobalColorTable: hasGCT, globalColorTableSize: gctSize,
    minPaletteSize: paletteSizes.length > 0 ? Math.min(...paletteSizes) : 0,
    maxPaletteSize: paletteSizes.length > 0 ? Math.max(...paletteSizes) : 0,
    avgPaletteSize: paletteSizes.length > 0 ? Math.round(paletteSizes.reduce((a, b) => a + b, 0) / paletteSizes.length) : 0,
    avgFrameCompressedBytes: compressedSizes.length > 0 ? Math.round(compressedSizes.reduce((a, b) => a + b, 0) / compressedSizes.length) : 0,
    minFrameCompressedBytes: compressedSizes.length > 0 ? Math.min(...compressedSizes) : 0,
    maxFrameCompressedBytes: compressedSizes.length > 0 ? Math.max(...compressedSizes) : 0,
    totalCompressedBytes: totalCompressed,
    fullFrameCount: fullFrames, subFrameCount: subFrames.length,
    avgSubFrameCoverage: Math.round(avgCoverage * 1000) / 1000,
    minSubFrameCoverage: Math.round(minCoverage * 1000) / 1000,
    transparentFrameCount: transparentCount,
    delays: uniqueDelays,
    avgDelay: frameDelays.length > 0 ? Math.round(frameDelays.reduce((a, b) => a + b, 0) / frameDelays.length * 1000) / 1000 : 0,
    minDelay: frameDelays.length > 0 ? Math.min(...frameDelays) : 0,
    maxDelay: frameDelays.length > 0 ? Math.max(...frameDelays) : 0,
    constantDelay: uniqueDelays.length <= 1,
    disposalMethods: disposals, loopCount, comments, interlaced,
    durationSeconds: Math.round(totalDuration * 100) / 100,
    effectiveFps: totalDuration > 0 ? Math.round(frameDims.length / totalDuration * 10) / 10 : 0,
    bitsPerPixel: frameDims.length > 0 ? Math.round(totalCompressed * 8 / (frameDims.length * w * h) * 10000) / 10000 : 0,
  };
}

function inspectGif(gifPath: string, canvasW: number, canvasH: number): GifInspection | null {
  if (!hasCommand("gifsicle")) return null;
  try {
    return parseGifsicleOutput(
      execSync(`gifsicle --sinfo "${gifPath}" 2>&1`, { encoding: "utf-8", timeout: 10000 }),
      canvasW, canvasH,
    );
  } catch { return null; }
}

// ── Quality metrics ──

function computeVmafMetrics(framesDir: string, gifPath: string, w: number, h: number, logDir: string) {
  const logVmaf = join(logDir, `${basename(gifPath, ".gif")}-vmaf.json`);
  const logCambi = join(logDir, `${basename(gifPath, ".gif")}-cambi.json`);

  let vmafMean: number | null = null, vmafMin: number | null = null;
  let ssim: number | null = null, psnr: number | null = null;
  let ciede: number | null = null, cambi: number | null = null;

  // VMAF + SSIM + PSNR + CIEDE2000
  try {
    const cmd =
      `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -r 20 -i "${gifPath}" ` +
      `-filter_complex "` +
      `[0:v]scale=${w}:${h}:flags=bicubic[ref];` +
      `[1:v]scale=${w}:${h}:flags=bicubic[dist];` +
      `[ref]split=3[r1][r2][r3];[dist]split=3[d1][d2][d3];` +
      `[r1][d1]libvmaf=log_path=${logVmaf}:log_fmt=json:feature=name=ciede;` +
      `[r2][d2]ssim;[r3][d3]psnr" -f null - 2>&1`;
    const out = execSync(cmd, { encoding: "utf-8", timeout: 300000 });
    const sm = out.match(/SSIM.*All:([\d.]+)/); if (sm) ssim = parseFloat(sm[1]);
    const pm = out.match(/PSNR.*average:([\d.]+)/); if (pm) psnr = parseFloat(pm[1]);
    if (existsSync(logVmaf)) {
      const d = JSON.parse(readFileSync(logVmaf, "utf-8")).pooled_metrics;
      vmafMean = d?.vmaf?.mean ?? null;
      vmafMin = d?.vmaf?.min ?? null;
      ciede = d?.ciede2000?.mean ?? null;
    }
  } catch {}

  // CAMBI
  try {
    execSync(`ffmpeg -y -i "${gifPath}" -filter_complex "[0:v]split[a][b];[a][b]libvmaf=feature=name=cambi:log_path=${logCambi}:log_fmt=json" -f null - 2>&1`,
      { encoding: "utf-8", timeout: 120000 });
    cambi = JSON.parse(readFileSync(logCambi, "utf-8")).pooled_metrics?.cambi?.mean ?? null;
  } catch {}

  return { vmafMean, vmafMin, ssim, psnr, ciede, cambi };
}

async function computeVmafMetricsAsync(framesDir: string, gifPath: string, w: number, h: number, logDir: string) {
  const logVmaf = join(logDir, `${basename(gifPath, ".gif")}-vmaf.json`);
  const logCambi = join(logDir, `${basename(gifPath, ".gif")}-cambi.json`);
  let vmafMean: number | null = null, vmafMin: number | null = null;
  let ssim: number | null = null, psnr: number | null = null;
  let ciede: number | null = null, cambi: number | null = null;

  try {
    const cmd =
      `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -r 20 -i "${gifPath}" ` +
      `-filter_complex "` +
      `[0:v]scale=${w}:${h}:flags=bicubic[ref];` +
      `[1:v]scale=${w}:${h}:flags=bicubic[dist];` +
      `[ref]split=3[r1][r2][r3];[dist]split=3[d1][d2][d3];` +
      `[r1][d1]libvmaf=log_path=${logVmaf}:log_fmt=json:feature=name=ciede;` +
      `[r2][d2]ssim;[r3][d3]psnr" -f null - 2>&1`;
    const { stdout: out } = await execAsync(cmd, { timeout: 300000 });
    const sm = out.match(/SSIM.*All:([\d.]+)/); if (sm) ssim = parseFloat(sm[1]);
    const pm = out.match(/PSNR.*average:([\d.]+)/); if (pm) psnr = parseFloat(pm[1]);
    if (existsSync(logVmaf)) {
      const d = JSON.parse(readFileSync(logVmaf, "utf-8")).pooled_metrics;
      vmafMean = d?.vmaf?.mean ?? null;
      vmafMin = d?.vmaf?.min ?? null;
      ciede = d?.ciede2000?.mean ?? null;
    }
  } catch {}

  try {
    await execAsync(
      `ffmpeg -y -i "${gifPath}" -filter_complex "[0:v]split[a][b];[a][b]libvmaf=feature=name=cambi:log_path=${logCambi}:log_fmt=json" -f null - 2>&1`,
      { timeout: 120000 },
    );
    cambi = JSON.parse(readFileSync(logCambi, "utf-8")).pooled_metrics?.cambi?.mean ?? null;
  } catch {}

  return { vmafMean, vmafMin, ssim, psnr, ciede, cambi };
}

async function inspectGifAsync(gifPath: string, canvasW: number, canvasH: number): Promise<GifInspection | null> {
  if (!hasCommand("gifsicle")) return null;
  try {
    const { stdout: out } = await execAsync(`gifsicle --sinfo "${gifPath}" 2>&1`, { timeout: 10000 });
    return parseGifsicleOutput(out, canvasW, canvasH);
  } catch { return null; }
}

// ── Main ──

async function main() {
  // Parse config
  const allFixtures = getAllFixtures();
  const PARALLEL_MODE = hasFlag("parallel");
  const FAST_MODE = hasFlag("fast");

  let fixtureArg = parseArg("fixtures", "");
  let fixtures = fixtureArg ? fixtureArg.split(",") : allFixtures;
  if (FAST_MODE && !fixtureArg) fixtures = fixtures.filter(f => FAST_FIXTURES.has(f));

  const resArg = parseArg("resolutions", "480,360,240,160");
  const resolutions = resArg.split(",").map(Number);

  const encoderArg = parseArg("encoders", "");
  let requestedEncoders = encoderArg ? encoderArg.split(",") : Object.keys(ALL_ENCODERS);
  if (FAST_MODE && !encoderArg)
    requestedEncoders = requestedEncoders.filter(n => n.startsWith("gifhero") || n.startsWith("gifski"));
  const availableEncoders = requestedEncoders.filter(n => ALL_ENCODERS[n]?.available());

  const defaultMetrics = FAST_MODE ? "vmaf,ssim,psnr,ciede,cambi" : "vmaf,ssim,psnr,ciede,cambi,dssim,tfs";
  const metricArg = parseArg("metrics", defaultMetrics);
  const enabledMetrics = new Set(metricArg.split(","));

  const baseDir = parseArg("out-dir", join(__dirname, "results"));
  const runId = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const runDir = join(baseDir, runId);
  const gifsDir = join(runDir, "gifs");
  const latestLink = join(baseDir, "latest");

  // --list mode
  if (hasFlag("list")) {
    console.log("\nAvailable fixtures:");
    for (const f of allFixtures) {
      const count = readdirSync(join(FIXTURES_DIR, f)).filter(f => f.endsWith(".png")).length;
      console.log(`  ${f} (${count} frames)`);
    }
    console.log("\nAvailable encoders:");
    for (const [name, enc] of Object.entries(ALL_ENCODERS)) {
      console.log(`  ${name}: ${enc.available() ? "available" : "NOT available"}`);
    }
    console.log("\nAvailable metrics: vmaf, ssim, psnr, ciede, cambi, dssim, tfs");
    return;
  }

  // Validate
  for (const f of fixtures) {
    if (!existsSync(join(FIXTURES_DIR, f))) {
      console.error(`Fixture not found: ${f}`);
      process.exit(1);
    }
  }
  for (const e of requestedEncoders) {
    if (!ALL_ENCODERS[e]) {
      console.error(`Unknown encoder: ${e}. Use --list to see available.`);
      process.exit(1);
    }
  }

  const vmafOk = hasVmafSupport();
  const dssimOk = isDssimAvailable();
  const TEMP_DIR = join(__dirname, ".tmp");

  mkdirSync(TEMP_DIR, { recursive: true });
  mkdirSync(gifsDir, { recursive: true });
  const logsDir = join(TEMP_DIR, "logs"); mkdirSync(logsDir, { recursive: true });
  const framesExtractDir = join(TEMP_DIR, "frames"); mkdirSync(framesExtractDir, { recursive: true });

  const totalJobs = fixtures.length * resolutions.length * availableEncoders.length;

  console.log("\n━━━ gifhero benchmark ━━━\n");
  if (FAST_MODE) console.log("  Fast mode: subset of fixtures and encoders, no DSSIM/TFS");
  if (PARALLEL_MODE) console.log("  Parallel mode: gifhero encoding via worker threads");
  console.log(`  Fixtures:     ${fixtures.join(", ")}`);
  console.log(`  Resolutions:  ${resolutions.map(r => r + "p").join(", ")}`);
  console.log(`  Encoders:     ${availableEncoders.join(", ")}`);
  console.log(`  Metrics:      ${[...enabledMetrics].join(", ")}`);
  console.log(`  Output:       ${runDir}`);
  console.log(`  Total jobs:   ${totalJobs}`);
  console.log(`  VMAF: ${vmafOk ? "yes" : "no"}  DSSIM: ${dssimOk ? "yes" : "no"}`);
  console.log("");

  const results: any[] = [];
  let completed = 0;
  const METRIC_CONCURRENCY = 8;

  // Pending metric jobs: encode first, measure later in parallel
  interface MetricJob {
    r: any;
    outputPath: string;
    srcDir: string;
    outW: number;
    outH: number;
    srcW: number;
    srcH: number;
    frameCount: number;
  }
  const metricJobs: MetricJob[] = [];

  // Collect metrics for a single GIF (async — safe for parallel execution)
  async function collectMetrics(
    r: any, outputPath: string, srcDir: string, outW: number, outH: number,
    srcW: number, srcH: number, frameCount: number,
  ) {
    const inspection = await inspectGifAsync(outputPath, outW, outH);
    if (inspection) r.gif = inspection;

    const extractDir = join(framesExtractDir, `${r.fixture}-${r.resolution}-${r.encoder}`);
    let framesExtracted = false;
    if (enabledMetrics.has("dssim") || enabledMetrics.has("tfs")) {
      try { extractGifFrames(outputPath, extractDir); framesExtracted = true; } catch {}
    }

    const needsVmaf = ["vmaf", "ssim", "psnr", "ciede", "cambi"].some(m => enabledMetrics.has(m));
    if (needsVmaf && vmafOk) {
      try {
        const vm = await computeVmafMetricsAsync(srcDir, outputPath, outW, outH, logsDir);
        if (enabledMetrics.has("vmaf")) { r.vmafMean = vm.vmafMean; r.vmafMin = vm.vmafMin; }
        if (enabledMetrics.has("ssim")) r.ssimMean = vm.ssim;
        if (enabledMetrics.has("psnr")) r.psnrMean = vm.psnr;
        if (enabledMetrics.has("ciede")) r.ciede2000 = vm.ciede;
        if (enabledMetrics.has("cambi")) r.cambiBanding = vm.cambi;
      } catch {}
    }

    if (enabledMetrics.has("dssim") && dssimOk && framesExtracted) {
      try {
        const extPngs = readdirSync(extractDir).filter(f => f.endsWith(".png")).sort();
        if (extPngs.length > 0) {
          const extImg = new Image();
          extImg.src = readFileSync(join(extractDir, extPngs[0]));
          const needsScale = extImg.width !== srcW || extImg.height !== srcH;
          const d = needsScale
            ? dssimFrames(srcDir, extractDir, extImg.width, extImg.height)
            : dssimFrames(srcDir, extractDir);
          r.dssimMean = d.mean; r.dssimMax = d.max; r.dssimP95 = d.p95;
        }
      } catch {}
    }

    if (enabledMetrics.has("tfs") && framesExtracted && frameCount >= 2) {
      try {
        const srcPngs = readdirSync(srcDir).filter(f => f.endsWith(".png")).sort();
        const extPngs = readdirSync(extractDir).filter(f => f.endsWith(".png")).sort();
        if (extPngs.length > 0) {
          const extImg = new Image(); extImg.src = readFileSync(join(extractDir, extPngs[0]));
          const tw = extImg.width, th = extImg.height;
          const count = Math.min(srcPngs.length, extPngs.length);
          const srcFrames: Uint8ClampedArray[] = [], encFrames: Uint8ClampedArray[] = [];
          for (let i = 0; i < count; i++) {
            const s = new Image(); s.src = readFileSync(join(srcDir, srcPngs[i]));
            const sc = createCanvas(tw, th); sc.getContext("2d").drawImage(s, 0, 0, tw, th);
            srcFrames.push(sc.getContext("2d").getImageData(0, 0, tw, th).data);
            const e = new Image(); e.src = readFileSync(join(extractDir, extPngs[i]));
            const ec = createCanvas(tw, th); ec.getContext("2d").drawImage(e, 0, 0, tw, th);
            encFrames.push(ec.getContext("2d").getImageData(0, 0, tw, th).data);
          }
          r.flickerScore = computeFlickerScore(srcFrames, encFrames, tw, th).score;
        }
      } catch {}
    }
  }

  if (PARALLEL_MODE) {
    // Phase 1: Encode everything in parallel — gifhero via workers, external via concurrent processes
    const gifheroEncoders = availableEncoders.filter(n => n.startsWith("gifhero"));
    const externalEncoders = availableEncoders.filter(n => !n.startsWith("gifhero"));

    // 1a. Batch gifhero via worker threads
    if (gifheroEncoders.length > 0) {
      const allJobs: EncodeJob[] = [];
      const jobMeta: Array<{ fixture: string; encoder: string; srcDir: string; outputPath: string;
        res: number; resSuffix: string; outW: number; outH: number; srcW: number; srcH: number; frameCount: number }> = [];

      for (const fixture of fixtures) {
        const srcDir = join(FIXTURES_DIR, fixture);
        const loaded = loadPngFrames(srcDir);
        const frameCount = loaded.frames.length;

        for (const res of resolutions) {
          const resSuffix = `-${res}p`;
          const outW = res < loaded.width ? res : loaded.width;
          const outH = res < loaded.width ? Math.round(loaded.height * outW / loaded.width) : loaded.height;

          for (const encName of gifheroEncoders) {
            const tw = res < loaded.width ? res : undefined;
            allJobs.push({
              frames: loaded.frames.map(f => ({ data: f.data, delay: f.delay })),
              width: loaded.width, height: loaded.height,
              options: { preset: "balanced" as any, lossyLzw: 0, ...(tw ? { targetWidth: tw } : {}) },
            });
            jobMeta.push({
              fixture, encoder: encName, srcDir,
              outputPath: join(gifsDir, `${fixture}${resSuffix}-${encName}.gif`),
              res, resSuffix, outW, outH, srcW: loaded.width, srcH: loaded.height, frameCount,
            });
          }
        }
      }

      console.log(`  Phase 1a: Encoding ${allJobs.length} gifhero jobs via workers...`);
      const t0 = performance.now();
      const gifs = await encodeParallel(allJobs, 8, (done, total) => {
        process.stdout.write(`\r    gifhero: ${done}/${total}`);
      });
      console.log(`\n    Done in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);

      for (let i = 0; i < gifs.length; i++) {
        const m = jobMeta[i];
        writeFileSync(m.outputPath, gifs[i]);
        const r: any = {
          fixture: m.fixture, resolution: `${m.res}p`,
          encoder: m.encoder, fileSize: gifs[i].byteLength, hash: bufHash(gifs[i]),
          encodingTimeMs: 0, frameCount: m.frameCount,
          outputWidth: m.outW, outputHeight: m.outH,
        };
        results.push(r);
        metricJobs.push({ r, outputPath: m.outputPath, srcDir: m.srcDir, outW: m.outW, outH: m.outH, srcW: m.srcW, srcH: m.srcH, frameCount: m.frameCount });
      }
    }

    // 1b. External encoders in parallel (8 concurrent child processes)
    if (externalEncoders.length > 0) {
      const extJobs: Array<{ fixture: string; encoder: string; srcDir: string; outputPath: string;
        res: number; resSuffix: string; outW: number; outH: number; srcW: number; srcH: number;
        frameCount: number; targetWidth: number | undefined }> = [];

      for (const fixture of fixtures) {
        const srcDir = join(FIXTURES_DIR, fixture);
        const frameCount = readdirSync(srcDir).filter(f => f.endsWith(".png")).length;
        const firstImg = new Image();
        firstImg.src = readFileSync(join(srcDir, readdirSync(srcDir).filter(f => f.endsWith(".png")).sort()[0]));
        const srcW = firstImg.width, srcH = firstImg.height;

        for (const res of resolutions) {
          const resSuffix = `-${res}p`;
          const targetWidth = res < srcW ? res : undefined;
          const outW = res < srcW ? res : srcW;
          const outH = res < srcW ? Math.round(srcH * outW / srcW) : srcH;

          for (const encName of externalEncoders) {
            extJobs.push({
              fixture, encoder: encName, srcDir,
              outputPath: join(gifsDir, `${fixture}${resSuffix}-${encName}.gif`),
              res, resSuffix, outW, outH, srcW, srcH, frameCount, targetWidth,
            });
          }
        }
      }

      console.log(`  Phase 1b: Encoding ${extJobs.length} external jobs (${METRIC_CONCURRENCY} parallel)...`);
      let extDone = 0;
      for (let i = 0; i < extJobs.length; i += METRIC_CONCURRENCY) {
        const batch = extJobs.slice(i, i + METRIC_CONCURRENCY);
        await Promise.all(batch.map(async (job) => {
          try {
            await ALL_ENCODERS[job.encoder].encode(job.srcDir, job.outputPath, job.targetWidth);
          } catch { return; }
          if (!existsSync(job.outputPath)) return;
          const fileSize = statSync(job.outputPath).size;
          const r: any = {
            fixture: job.fixture, resolution: `${job.res}p`,
            encoder: job.encoder, fileSize, hash: fileHash(job.outputPath),
            encodingTimeMs: 0, frameCount: job.frameCount,
            outputWidth: job.outW, outputHeight: job.outH,
          };
          results.push(r);
          metricJobs.push({ r, outputPath: job.outputPath, srcDir: job.srcDir, outW: job.outW, outH: job.outH, srcW: job.srcW, srcH: job.srcH, frameCount: job.frameCount });
          extDone++;
          process.stdout.write(`\r    external: ${extDone}/${extJobs.length}`);
        }));
      }
      console.log("\n");
    }

    // Phase 2: Metrics in parallel
    console.log(`  Phase 2: Metrics (${metricJobs.length} jobs, ${METRIC_CONCURRENCY} parallel)...\n`);
    let metricsDone = 0;
    for (let i = 0; i < metricJobs.length; i += METRIC_CONCURRENCY) {
      const batch = metricJobs.slice(i, i + METRIC_CONCURRENCY);
      await Promise.all(batch.map(async (job) => {
        await collectMetrics(job.r, job.outputPath, job.srcDir, job.outW, job.outH, job.srcW, job.srcH, job.frameCount);
        metricsDone++;
        process.stdout.write(`\r    ${metricsDone}/${metricJobs.length}`);
      }));
    }
    console.log("\n");

  } else {
    // Default mode: encode sequentially (accurate timing), metrics in parallel
    console.log("  Phase 1: Encoding...\n");
    for (const fixture of fixtures) {
      const srcDir = join(FIXTURES_DIR, fixture);
      const frameCount = readdirSync(srcDir).filter(f => f.endsWith(".png")).length;
      const firstImg = new Image();
      firstImg.src = readFileSync(join(srcDir, readdirSync(srcDir).filter(f => f.endsWith(".png")).sort()[0]));
      const srcW = firstImg.width, srcH = firstImg.height;

      for (const res of resolutions) {
        const resSuffix = `-${res}p`;
        const targetWidth = res < srcW ? res : undefined;
        const outW = res < srcW ? res : srcW;
        const outH = res < srcW ? Math.round(srcH * outW / srcW) : srcH;

        for (const encName of availableEncoders) {
          const outputPath = join(gifsDir, `${fixture}${resSuffix}-${encName}.gif`);
          const t0 = performance.now();
          let encResult: EncodeResult | void;
          try {
            encResult = await ALL_ENCODERS[encName].encode(srcDir, outputPath, targetWidth);
          } catch (err) {
            console.log(`    ✗ ${encName}: FAILED — ${(err as Error).message}`);
            continue;
          }
          const encTime = Math.round(performance.now() - t0);
          if (!existsSync(outputPath)) { console.log(`    ✗ ${encName}: no output`); continue; }
          const fileSize = statSync(outputPath).size;
          const hash = fileHash(outputPath);
          const r: any = {
            fixture, resolution: `${res}p`,
            encoder: encName, fileSize, hash, encodingTimeMs: encTime, frameCount,
            outputWidth: outW, outputHeight: outH,
            ...(encResult?.timing ? { timing: encResult.timing } : {}),
          };
          results.push(r);
          metricJobs.push({ r, outputPath, srcDir, outW, outH, srcW, srcH, frameCount });
          console.log(`    ${fixture}${resSuffix} ${encName}: ${(fileSize/1024).toFixed(0)} KB, ${encTime}ms [${results.length}/${totalJobs}]`);
        }
      }
    }

    // Phase 2: Collect metrics in parallel
    console.log(`\n  Phase 2: Metrics (${metricJobs.length} jobs, ${METRIC_CONCURRENCY} parallel)...\n`);
    let metricsDone = 0;
    const runBatch = async (batch: MetricJob[]) => {
      await Promise.all(batch.map(async (job) => {
        await collectMetrics(job.r, job.outputPath, job.srcDir, job.outW, job.outH, job.srcW, job.srcH, job.frameCount);
        metricsDone++;
        process.stdout.write(`\r    ${metricsDone}/${metricJobs.length}`);
      }));
    };
    for (let i = 0; i < metricJobs.length; i += METRIC_CONCURRENCY) {
      await runBatch(metricJobs.slice(i, i + METRIC_CONCURRENCY));
    }
    console.log("\n");
  }

  // Save results
  const outPath = join(runDir, "results.json");
  writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), runId, config: {
    fixtures, resolutions: resolutions.map(r => `${r}p`),
    encoders: availableEncoders, metrics: [...enabledMetrics],
  }, results }, null, 2));

  // Symlink latest -> this run
  try { unlinkSync(latestLink); } catch {}
  symlinkSync(runId, latestLink);

  console.log(`Results: ${runDir}`);

  // Print summary table
  console.log("\n━━━ SUMMARY ━━━\n");
  const cols = ["Fixture", "Res", "Encoder", "Size KB", "Time"];
  if (enabledMetrics.has("vmaf")) cols.push("VMAF");
  if (enabledMetrics.has("ssim")) cols.push("SSIM");
  if (enabledMetrics.has("psnr")) cols.push("PSNR");
  if (enabledMetrics.has("dssim")) cols.push("DSSIM");
  if (enabledMetrics.has("tfs")) cols.push("TFS");

  for (const r of results) {
    const parts = [
      r.fixture.padEnd(17),
      (r.resolution as string).padStart(6),
      r.encoder.padEnd(17),
      (r.fileSize / 1024).toFixed(0).padStart(7),
      (r.encodingTimeMs < 1000 ? r.encodingTimeMs + "ms" : (r.encodingTimeMs/1000).toFixed(1) + "s").padStart(7),
    ];
    if (enabledMetrics.has("vmaf")) parts.push((r.vmafMean?.toFixed(1) ?? "N/A").padStart(5));
    if (enabledMetrics.has("ssim")) parts.push((r.ssimMean?.toFixed(4) ?? "N/A").padStart(6));
    if (enabledMetrics.has("psnr")) parts.push((r.psnrMean?.toFixed(1) ?? "N/A").padStart(5));
    if (enabledMetrics.has("dssim")) parts.push((r.dssimMean?.toFixed(4) ?? "N/A").padStart(6));
    if (enabledMetrics.has("tfs")) parts.push((r.flickerScore?.toFixed(4) ?? "N/A").padStart(6));
    console.log(parts.join(" | "));
  }

  // Cleanup temp files (extracted frames, VMAF logs)
  rmSync(TEMP_DIR, { recursive: true, force: true });
}

main().catch(console.error);
