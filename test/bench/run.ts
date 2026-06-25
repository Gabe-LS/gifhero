/**
 * gifhero benchmark runner
 *
 * Encodes every test fixture with every available encoder,
 * measures quality metrics (VMAF, CAMBI, CIEDE2000, SSIM, PSNR,
 * DSSIM, TFS), and outputs a comparison table.
 *
 * Run: npm run bench
 */

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { isDssimAvailable, dssimFrames, extractGifFrames } from "../metrics/dssim.js";
import { computeFlickerScore } from "../metrics/flicker.js";
import { encode } from "../../src/index.js";
import { encodeParallel } from "./parallel.js";
import type { EncodeJob } from "./parallel.js";

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");
const RESULTS_DIR = join(__dirname, "results");
const TEMP_DIR = join(__dirname, ".tmp");

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface EncoderResult {
  encoder: string;
  fixture: string;
  fileSize: number;
  encodingTimeMs: number;
  frameCount: number;
  gifPath: string;
  // VMAF suite (from single ffmpeg libvmaf pass)
  vmafMean: number | null;
  vmafMin: number | null;
  cambiBanding: number | null;
  ciede2000: number | null;
  ssimMean: number | null;
  psnrMean: number | null;
  // DSSIM (from dssim CLI)
  dssimMean: number | null;
  dssimMax: number | null;
  dssimP95: number | null;
  // TFS (temporal flicker)
  flickerScore: number | null;
  // Derived
  vmafPerMB: number | null;
}

interface VmafMetrics {
  vmafMean: number | null;
  vmafMin: number | null;
  cambiBanding: number | null;
  ciede2000: number | null;
  ssimMean: number | null;
  psnrMean: number | null;
}

interface BenchmarkReport {
  timestamp: string;
  gitCommit: string | null;
  results: Omit<EncoderResult, "gifPath">[];
}

// ─────────────────────────────────────────────
// Tool detection
// ─────────────────────────────────────────────

function hasCommand(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasVmafSupport(): boolean {
  try {
    const output = execSync("ffmpeg -filters 2>&1", {
      encoding: "utf-8",
      timeout: 10000,
    });
    return output.includes("libvmaf");
  } catch {
    return false;
  }
}

function getGitCommit(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Encoders
// ─────────────────────────────────────────────

type EncoderFn = (framesDir: string, outputPath: string, frameCount: number) => void | Promise<void>;

// Resolution variants: suffix → target width (null = native)
const RESOLUTIONS: Array<{ suffix: string; targetWidth: number | null }> = [
  { suffix: "",      targetWidth: null },
  { suffix: "-360p", targetWidth: 360 },
  { suffix: "-240p", targetWidth: 240 },
  { suffix: "-160p", targetWidth: 160 },
];

// Build encoder entries dynamically
const encoders: Record<string, { available: () => boolean; encode: EncoderFn }> = {};

for (const { suffix, targetWidth } of RESOLUTIONS) {
  // ── gifhero ──
  encoders[`gifhero-balanced${suffix}`] = {
    available: () => true,
    encode: async (framesDir, outputPath) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      const tw = targetWidth && targetWidth < width ? targetWidth : undefined;
      writeFileSync(outputPath, await encode({
        width, height, frames, preset: "balanced",
        ...(tw ? { targetWidth: tw } : {}),
      }));
    },
  };

  encoders[`gifhero-quality${suffix}`] = {
    available: () => true,
    encode: async (framesDir, outputPath) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      const tw = targetWidth && targetWidth < width ? targetWidth : undefined;
      writeFileSync(outputPath, await encode({
        width, height, frames, preset: "quality",
        ...(tw ? { targetWidth: tw } : {}),
      }));
    },
  };

  // ── gifski (default: quality 90, lossy-quality 100) ──
  encoders[`gifski${suffix}`] = {
    available: () => hasCommand("gifski"),
    encode: (framesDir, outputPath) => {
      const widthFlag = targetWidth ? `--width ${targetWidth} ` : "";
      execSync(
        `gifski --fps 20 ${widthFlag}-o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" }
      );
    },
  };

  // ── gifski aggressive (quality 80, lossy-quality 30) ──
  encoders[`gifski-lossy${suffix}`] = {
    available: () => hasCommand("gifski"),
    encode: (framesDir, outputPath) => {
      const widthFlag = targetWidth ? `--width ${targetWidth} ` : "";
      execSync(
        `gifski --fps 20 --quality 80 --lossy-quality 30 ${widthFlag}-o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" }
      );
    },
  };

  // ── ffmpeg (palettegen + paletteuse, the standard approach) ──
  encoders[`ffmpeg${suffix}`] = {
    available: () => hasCommand("ffmpeg"),
    encode: (framesDir, outputPath) => {
      const scaleFilter = targetWidth
        ? `scale=${targetWidth}:-1:flags=lanczos,`
        : "";
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scaleFilter}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" "${outputPath}"`,
        { stdio: "ignore", timeout: 120000 }
      );
    },
  };

  // ── ImageMagick ──
  encoders[`magick${suffix}`] = {
    available: () => hasCommand("magick"),
    encode: (framesDir, outputPath) => {
      const resizeFlag = targetWidth ? `-resize ${targetWidth}x` : "";
      execSync(
        `magick -delay 5 -loop 0 "${framesDir}/"*.png ${resizeFlag} -layers OptimizeFrame "${outputPath}"`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" }
      );
    },
  };

  // ── gifsicle (from ffmpeg output — gifsicle can't encode from PNGs directly) ──
  encoders[`ffmpeg+gifsicle${suffix}`] = {
    available: () => hasCommand("ffmpeg") && hasCommand("gifsicle"),
    encode: (framesDir, outputPath) => {
      const scaleFilter = targetWidth
        ? `scale=${targetWidth}:-1:flags=lanczos,`
        : "";
      const tmpGif = outputPath + ".tmp.gif";
      // ffmpeg basic encode (no fancy palette)
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scaleFilter}split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${tmpGif}"`,
        { stdio: "ignore", timeout: 120000 }
      );
      // gifsicle optimize
      execSync(
        `gifsicle -O3 --lossy=80 "${tmpGif}" -o "${outputPath}"`,
        { stdio: "ignore", timeout: 60000 }
      );
      try { rmSync(tmpGif); } catch {}
    },
  };
}

function loadPngFrames(dir: string): {
  width: number;
  height: number;
  frames: Array<{ data: Uint8ClampedArray; delay: number }>;
} {
  const files = readdirSync(dir).filter((f: string) => f.endsWith(".png")).sort();
  let width = 0;
  let height = 0;
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

// ─────────────────────────────────────────────
// Fixture discovery
// ─────────────────────────────────────────────

function getFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];

  return readdirSync(FIXTURES_DIR)
    .filter((name) => {
      const dir = join(FIXTURES_DIR, name);
      if (!statSync(dir).isDirectory()) return false;
      const pngs = readdirSync(dir).filter((f) => f.endsWith(".png"));
      return pngs.length >= 2;
    })
    .sort();
}

function countFrames(dir: string): number {
  return readdirSync(dir).filter((f) => f.endsWith(".png")).length;
}

// ─────────────────────────────────────────────
// Frame validation
// ─────────────────────────────────────────────

interface FrameValidation {
  valid: boolean;
  sourceCount: number;
  extractedCount: number;
  width: number;
  height: number;
}

function validateFrames(
  sourceDir: string,
  extractedDir: string,
  encoderName: string,
  fixtureName: string
): FrameValidation {
  const sourcePngs = readdirSync(sourceDir).filter((f) => f.endsWith(".png")).sort();
  const extractedPngs = readdirSync(extractedDir).filter((f) => f.endsWith(".png")).sort();

  if (sourcePngs.length !== extractedPngs.length) {
    console.log(
      `    ⚠ Frame count mismatch: ${sourcePngs.length} source vs ` +
      `${extractedPngs.length} extracted for ${encoderName}/${fixtureName}`
    );
    return {
      valid: false,
      sourceCount: sourcePngs.length,
      extractedCount: extractedPngs.length,
      width: 0,
      height: 0,
    };
  }

  // Check dimensions of first frame in each
  const srcImg = new Image();
  srcImg.src = readFileSync(join(sourceDir, sourcePngs[0]));
  const extImg = new Image();
  extImg.src = readFileSync(join(extractedDir, extractedPngs[0]));

  if (srcImg.width !== extImg.width || srcImg.height !== extImg.height) {
    console.log(
      `    ⚠ Dimension mismatch: ${srcImg.width}x${srcImg.height} source vs ` +
      `${extImg.width}x${extImg.height} extracted for ${encoderName}/${fixtureName}`
    );
    return {
      valid: false,
      sourceCount: sourcePngs.length,
      extractedCount: extractedPngs.length,
      width: srcImg.width,
      height: srcImg.height,
    };
  }

  return {
    valid: true,
    sourceCount: sourcePngs.length,
    extractedCount: extractedPngs.length,
    width: srcImg.width,
    height: srcImg.height,
  };
}

// ─────────────────────────────────────────────
// VMAF + SSIM + PSNR (single ffmpeg pass)
// ─────────────────────────────────────────────

const NULL_VMAF: VmafMetrics = {
  vmafMean: null,
  vmafMin: null,
  cambiBanding: null,
  ciede2000: null,
  ssimMean: null,
  psnrMean: null,
};

function computeVmafMetrics(
  sourceDir: string,
  gifPath: string,
  width: number,
  height: number,
  logDir: string
): VmafMetrics {
  const logVmaf = join(logDir, `${basename(gifPath, ".gif")}-vmaf.json`);
  const logCambi = join(logDir, `${basename(gifPath, ".gif")}-cambi.json`);
  mkdirSync(logDir, { recursive: true });

  // Pass 1: VMAF + CIEDE2000 + SSIM + PSNR (reference vs distorted)
  const cmd =
    `ffmpeg -y -framerate 20 -i "${sourceDir}/%04d.png" -i "${gifPath}" ` +
    `-filter_complex "` +
    `[1:v]scale=${width}:${height}:flags=bicubic[dist];` +
    `[0:v]split=3[r1][r2][r3];` +
    `[dist]split=3[d1][d2][d3];` +
    `[r1][d1]libvmaf=log_path=${logVmaf}:log_fmt=json:feature=name=ciede;` +
    `[r2][d2]ssim;` +
    `[r3][d3]psnr` +
    `" -f null - 2>&1`;

  let output: string;
  try {
    output = execSync(cmd, { encoding: "utf-8", timeout: 300000 });
  } catch {
    return NULL_VMAF;
  }

  let ssimMean: number | null = null;
  const ssimMatch = output.match(/SSIM.*All:([\d.]+)/);
  if (ssimMatch) {
    ssimMean = parseFloat(ssimMatch[1]);
    if (isNaN(ssimMean)) ssimMean = null;
  }

  let psnrMean: number | null = null;
  const psnrMatch = output.match(/PSNR.*average:([\d.]+)/);
  if (psnrMatch) {
    psnrMean = parseFloat(psnrMatch[1]);
    if (isNaN(psnrMean)) psnrMean = null;
  }

  let vmafMean: number | null = null;
  let vmafMin: number | null = null;
  let ciede2000: number | null = null;

  try {
    const data = JSON.parse(readFileSync(logVmaf, "utf-8"));
    const pooled = data.pooled_metrics;
    if (pooled?.vmaf) {
      vmafMean = pooled.vmaf.mean ?? null;
      vmafMin = pooled.vmaf.min ?? null;
    }
    if (pooled?.ciede2000) {
      const v = pooled.ciede2000.mean;
      ciede2000 = v !== null && v !== undefined ? v : null;
    }
  } catch {}

  // Pass 2: CAMBI (no-reference, measured on the distorted GIF only).
  // CAMBI detects banding artifacts in the output — using the GIF as
  // both inputs ensures we measure the GIF, not the source.
  let cambiBanding: number | null = null;
  try {
    const cambiCmd =
      `ffmpeg -y -i "${gifPath}" ` +
      `-filter_complex "[0:v]split[a][b];[a][b]libvmaf=feature=name=cambi:log_path=${logCambi}:log_fmt=json" ` +
      `-f null - 2>&1`;
    execSync(cambiCmd, { encoding: "utf-8", timeout: 120000 });
    const data = JSON.parse(readFileSync(logCambi, "utf-8"));
    if (data.pooled_metrics?.cambi) {
      cambiBanding = data.pooled_metrics.cambi.mean ?? null;
    }
  } catch {}

  return { vmafMean, vmafMin, cambiBanding, ciede2000, ssimMean, psnrMean };
}

// ─────────────────────────────────────────────
// Temporal Flicker Score
// ─────────────────────────────────────────────

function computeTFS(
  sourceDir: string,
  extractedDir: string,
  width: number,
  height: number,
  frameCount: number
): number | null {
  if (frameCount < 2) return null;

  const sourcePngs = readdirSync(sourceDir).filter((f) => f.endsWith(".png")).sort();
  const extractedPngs = readdirSync(extractedDir).filter((f) => f.endsWith(".png")).sort();

  const count = Math.min(sourcePngs.length, extractedPngs.length, frameCount);

  const sourceFrames: Uint8ClampedArray[] = [];
  const encodedFrames: Uint8ClampedArray[] = [];

  for (let i = 0; i < count; i++) {
    // Load source frame
    const srcImg = new Image();
    srcImg.src = readFileSync(join(sourceDir, sourcePngs[i]));
    const srcCanvas = createCanvas(width, height);
    const srcCtx = srcCanvas.getContext("2d");
    srcCtx.drawImage(srcImg, 0, 0, width, height);
    sourceFrames.push(srcCtx.getImageData(0, 0, width, height).data);

    // Load extracted frame
    const extImg = new Image();
    extImg.src = readFileSync(join(extractedDir, extractedPngs[i]));
    const extCanvas = createCanvas(width, height);
    const extCtx = extCanvas.getContext("2d");
    extCtx.drawImage(extImg, 0, 0, width, height);
    encodedFrames.push(extCtx.getImageData(0, 0, width, height).data);
  }

  try {
    const result = computeFlickerScore(sourceFrames, encodedFrames, width, height);
    return result.score;
  } catch (err) {
    console.log(`    ⚠ TFS failed: ${(err as Error).message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// Benchmark logic
// ─────────────────────────────────────────────

async function measureEncoder(
  encoderName: string,
  fixtureName: string,
  framesDir: string,
  outputPath: string,
  fileSize: number,
  encodingTimeMs: number,
  frameCount: number,
  vmafAvailable: boolean,
  dssimAvail: boolean,
): Promise<EncoderResult | null> {
  const framesExtractDir = join(TEMP_DIR, "frames");
  const logsDir = join(TEMP_DIR, "logs");
  mkdirSync(framesExtractDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const extractDir = join(framesExtractDir, `${fixtureName}-${encoderName}`);
  try {
    extractGifFrames(outputPath, extractDir);
  } catch {
    return {
      encoder: encoderName, fixture: fixtureName, fileSize, encodingTimeMs,
      frameCount, gifPath: outputPath,
      vmafMean: null, vmafMin: null, cambiBanding: null, ciede2000: null,
      ssimMean: null, psnrMean: null, dssimMean: null, dssimMax: null,
      dssimP95: null, flickerScore: null, vmafPerMB: null,
    };
  }

  const validation = validateFrames(framesDir, extractDir, encoderName, fixtureName);
  let vmafMetrics = NULL_VMAF;
  let dssimMean: number | null = null;
  let dssimMax: number | null = null;
  let dssimP95: number | null = null;
  let flickerScore: number | null = null;

  if (validation.valid) {
    if (vmafAvailable) {
      try {
        vmafMetrics = computeVmafMetrics(framesDir, outputPath, validation.width, validation.height, logsDir);
      } catch {}
    }
    if (dssimAvail) {
      try {
        const d = dssimFrames(framesDir, extractDir);
        dssimMean = d.mean; dssimMax = d.max; dssimP95 = d.p95;
      } catch {}
    }
    if (frameCount >= 2 && !FAST_MODE) {
      try {
        flickerScore = computeTFS(framesDir, extractDir, validation.width, validation.height, frameCount);
      } catch {}
    }
  }

  const vmafPerMB = vmafMetrics.vmafMean !== null
    ? vmafMetrics.vmafMean / (fileSize / (1024 * 1024)) : null;

  return {
    encoder: encoderName, fixture: fixtureName, fileSize, encodingTimeMs,
    frameCount, gifPath: outputPath,
    vmafMean: vmafMetrics.vmafMean, vmafMin: vmafMetrics.vmafMin,
    cambiBanding: vmafMetrics.cambiBanding, ciede2000: vmafMetrics.ciede2000,
    ssimMean: vmafMetrics.ssimMean, psnrMean: vmafMetrics.psnrMean,
    dssimMean, dssimMax, dssimP95, flickerScore, vmafPerMB,
  };
}

async function benchmarkEncoder(
  encoderName: string,
  encodeFn: EncoderFn,
  fixtureName: string,
  framesDir: string,
  vmafAvailable: boolean,
  dssimAvail: boolean
): Promise<EncoderResult | null> {
  const gifsDir = join(TEMP_DIR, "gifs");
  const framesExtractDir = join(TEMP_DIR, "frames");
  const logsDir = join(TEMP_DIR, "logs");
  mkdirSync(gifsDir, { recursive: true });
  mkdirSync(framesExtractDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  const outputPath = join(gifsDir, `${fixtureName}-${encoderName}.gif`);
  const frameCount = countFrames(framesDir);

  // Encode and time it
  const start = performance.now();
  try {
    await encodeFn(framesDir, outputPath, frameCount);
  } catch (err) {
    console.error(`    ✗ ${encoderName} failed: ${(err as Error).message}`);
    return null;
  }
  const encodingTimeMs = Math.round(performance.now() - start);

  if (!existsSync(outputPath)) {
    console.error(`    ✗ ${encoderName} produced no output`);
    return null;
  }

  const fileSize = statSync(outputPath).size;

  // Extract GIF frames
  const extractDir = join(framesExtractDir, `${fixtureName}-${encoderName}`);
  try {
    extractGifFrames(outputPath, extractDir);
  } catch (err) {
    console.error(`    ⚠ Frame extraction failed: ${(err as Error).message}`);
    return {
      encoder: encoderName,
      fixture: fixtureName,
      fileSize,
      encodingTimeMs,
      frameCount,
      gifPath: outputPath,
      vmafMean: null,
      vmafMin: null,
      cambiBanding: null,
      ciede2000: null,
      ssimMean: null,
      psnrMean: null,
      dssimMean: null,
      dssimMax: null,
      dssimP95: null,
      flickerScore: null,
      vmafPerMB: null,
    };
  }

  // Validate frames
  const validation = validateFrames(framesDir, extractDir, encoderName, fixtureName);

  let vmafMetrics = NULL_VMAF;
  let dssimMean: number | null = null;
  let dssimMax: number | null = null;
  let dssimP95: number | null = null;
  let flickerScore: number | null = null;

  if (validation.valid) {
    // VMAF suite
    if (vmafAvailable) {
      try {
        vmafMetrics = computeVmafMetrics(
          framesDir,
          outputPath,
          validation.width,
          validation.height,
          logsDir
        );
      } catch (err) {
        console.log(`    ⚠ VMAF failed: ${(err as Error).message}`);
      }
    }

    // DSSIM
    if (dssimAvail) {
      try {
        const dssim = dssimFrames(framesDir, extractDir);
        dssimMean = dssim.mean;
        dssimMax = dssim.max;
        dssimP95 = dssim.p95;
      } catch (err) {
        console.log(`    ⚠ DSSIM failed: ${(err as Error).message}`);
      }
    }

    // TFS (skip in fast mode — loading 60 RGBA frame pairs is expensive)
    if (frameCount >= 2 && !FAST_MODE) {
      try {
        flickerScore = computeTFS(
          framesDir,
          extractDir,
          validation.width,
          validation.height,
          frameCount
        );
      } catch (err) {
        console.log(`    ⚠ TFS failed: ${(err as Error).message}`);
      }
    }
  }

  // Rate-distortion
  const vmafPerMB =
    vmafMetrics.vmafMean !== null
      ? vmafMetrics.vmafMean / (fileSize / (1024 * 1024))
      : null;

  return {
    encoder: encoderName,
    fixture: fixtureName,
    fileSize,
    encodingTimeMs,
    frameCount,
    gifPath: outputPath,
    vmafMean: vmafMetrics.vmafMean,
    vmafMin: vmafMetrics.vmafMin,
    cambiBanding: vmafMetrics.cambiBanding,
    ciede2000: vmafMetrics.ciede2000,
    ssimMean: vmafMetrics.ssimMean,
    psnrMean: vmafMetrics.psnrMean,
    dssimMean,
    dssimMax,
    dssimP95,
    flickerScore,
    vmafPerMB,
  };
}

// ─────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtVmaf(v: number | null): string {
  if (v === null) return "  n/a";
  return v.toFixed(1).padStart(5);
}

function fmtCambi(v: number | null): string {
  if (v === null) return " n/a";
  return v.toFixed(2).padStart(5);
}

function fmtCiede(v: number | null): string {
  if (v === null) return " n/a";
  return v.toFixed(2).padStart(5);
}

function fmtDssim(v: number | null): string {
  if (v === null) return "    n/a";
  return v.toFixed(5).padStart(7);
}

function fmtTfs(v: number | null): string {
  if (v === null) return "  n/a";
  return v.toFixed(3).padStart(5);
}

function fmtVmafPerMB(v: number | null): string {
  if (v === null) return "   n/a";
  return v.toFixed(1).padStart(6);
}

function sortResults(rows: EncoderResult[], vmafAvailable: boolean): EncoderResult[] {
  if (vmafAvailable && rows.some((r) => r.vmafMean !== null)) {
    return [...rows].sort((a, b) => (b.vmafMean ?? -1) - (a.vmafMean ?? -1));
  }
  return [...rows].sort((a, b) => (a.dssimMean ?? 999) - (b.dssimMean ?? 999));
}

function printTable(results: EncoderResult[], vmafAvailable: boolean) {
  const fixtures = [...new Set(results.map((r) => r.fixture))];

  for (const fixture of fixtures) {
    const rows = sortResults(
      results.filter((r) => r.fixture === fixture),
      vmafAvailable
    );

    const frameLabel = `${rows[0]?.frameCount ?? "?"} frames`;
    const header =
      "Encoder".padEnd(20) +
      " VMAF".padStart(5) +
      " CAMBI".padStart(6) +
      " CIEDE".padStart(6) +
      "  DSSIM".padStart(8) +
      "   TFS".padStart(6) +
      "    Size".padStart(8) +
      " VMAF/MB".padStart(8) +
      "    Time".padStart(8);

    const rule = "─".repeat(header.length);

    console.log("");
    console.log(`  ┌─ ${fixture} (${frameLabel}) ${"─".repeat(Math.max(0, header.length - fixture.length - frameLabel.length - 6))}`);
    console.log(`  │ ${header}`);
    console.log(`  │ ${rule}`);

    for (const row of rows) {
      console.log(
        `  │ ` +
        row.encoder.padEnd(20) +
        fmtVmaf(row.vmafMean) +
        " " +
        fmtCambi(row.cambiBanding) +
        " " +
        fmtCiede(row.ciede2000) +
        " " +
        fmtDssim(row.dssimMean) +
        " " +
        fmtTfs(row.flickerScore) +
        " " +
        formatSize(row.fileSize).padStart(7) +
        " " +
        fmtVmafPerMB(row.vmafPerMB) +
        " " +
        formatTime(row.encodingTimeMs).padStart(7)
      );
    }
    console.log(`  └${rule}─`);
  }
}

function oneLiner(result: EncoderResult, vmafAvailable: boolean): string {
  const quality = vmafAvailable && result.vmafMean !== null
    ? `VMAF ${result.vmafMean.toFixed(1)}`
    : result.dssimMean !== null
      ? `DSSIM ${result.dssimMean.toFixed(5)}`
      : "no quality data";
  return ` ${quality}, ${formatSize(result.fileSize)}, ${formatTime(result.encodingTimeMs)}`;
}

// ─────────────────────────────────────────────
// CLI flags
// ─────────────────────────────────────────────

const FAST_MODE = process.argv.includes("--fast");
const PARALLEL_MODE = process.argv.includes("--parallel");

const FAST_FIXTURES = new Set([
  "big-buck-bunny", "jellyfish", "candle-flame", "screencast", "talking-head", "skin-tones",
]);
const FAST_ENCODERS = new Set(
  RESOLUTIONS.flatMap(({ suffix }) => [`gifski${suffix}`, `gifhero-balanced${suffix}`, `gifhero-quality${suffix}`]),
);

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("━━━ gifhero benchmark ━━━");
  if (FAST_MODE) console.log("  ⚡ Fast mode: subset of fixtures and encoders, no TFS/DSSIM");
  if (PARALLEL_MODE) console.log("  ⚠ Parallel mode: timing values are not comparable");
  console.log("");

  // Clean / create temp and results dirs
  mkdirSync(TEMP_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  // Detect tools
  const ffmpegOk = hasCommand("ffmpeg");
  const vmafOk = ffmpegOk && hasVmafSupport();
  const dssimOk = isDssimAvailable();
  const gifsicleOk = hasCommand("gifsicle");
  const gifskiOk = hasCommand("gifski");

  console.log(`  ffmpeg:   ${ffmpegOk ? "available" : "not installed"}`);
  console.log(
    `  VMAF:     ${vmafOk
      ? "available (ffmpeg with libvmaf)"
      : "⚠ VMAF not available (ffmpeg not built with libvmaf), falling back to DSSIM only"}`
  );
  console.log(`  dssim:    ${dssimOk ? "available" : "not installed (brew install dssim)"}`);
  console.log(`  gifski:   ${gifskiOk ? "available" : "not installed"}`);
  console.log(`  gifsicle: ${gifsicleOk ? "available" : "not installed"}`);

  let fixtures = getFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found. Run: npm run bench:setup");
    process.exit(1);
  }
  if (FAST_MODE) fixtures = fixtures.filter((f) => FAST_FIXTURES.has(f));

  // Detect available encoders
  let available = Object.entries(encoders)
    .filter(([, e]) => e.available())
    .map(([name]) => name);
  if (FAST_MODE) available = available.filter((n) => FAST_ENCODERS.has(n));

  const runDssim = dssimOk && !FAST_MODE;

  console.log("");
  console.log(`  Fixtures: ${fixtures.join(", ")}`);
  console.log(`  Encoders: ${available.length > 0 ? available.join(", ") : "none found!"}`);

  if (available.length === 0) {
    console.error("Install at least one: brew install gifski ffmpeg gifsicle");
    process.exit(1);
  }

  console.log("");

  // Run benchmarks
  const allResults: EncoderResult[] = [];

  const gifheroEncoderNames = available.filter((n) => n.startsWith("gifhero"));
  const externalEncoders = available.filter((n) => !n.startsWith("gifhero"));

  if (PARALLEL_MODE) {
    const gifsDir = join(TEMP_DIR, "gifs");
    mkdirSync(gifsDir, { recursive: true });

    // 1a. Batch ALL gifhero variants in one encodeParallel call
    // (fixtures × resolutions jobs, all 16 workers simultaneously)
    if (gifheroEncoderNames.length > 0) {
      console.log(`  Phase 1a: Encoding gifhero (${gifheroEncoderNames.length} variants × ${fixtures.length} fixtures = ${gifheroEncoderNames.length * fixtures.length} jobs)...`);

      const allJobs: EncodeJob[] = [];
      const jobLabels: Array<{ fixture: string; encoder: string }> = [];

      // Load each fixture once, create jobs for all resolutions
      for (const fixture of fixtures) {
        const framesDir = join(FIXTURES_DIR, fixture);
        const loaded = loadPngFrames(framesDir);

        for (const encoderName of gifheroEncoderNames) {
          const isQualityPreset = encoderName.startsWith("gifhero-quality");
          const suffix = isQualityPreset
            ? encoderName.replace("gifhero-quality", "")
            : encoderName.replace("gifhero-balanced", "");
          const res = RESOLUTIONS.find((r) => r.suffix === suffix);
          const tw = res?.targetWidth && res.targetWidth < loaded.width
            ? res.targetWidth : undefined;

          allJobs.push({
            frames: loaded.frames.map((f) => ({ data: f.data, delay: f.delay })),
            width: loaded.width, height: loaded.height,
            options: {
              preset: (isQualityPreset ? "quality" : "balanced") as any,
              ...(tw ? { targetWidth: tw } : {}),
            },
          });
          jobLabels.push({ fixture, encoder: encoderName });
        }
      }

      const gifs = await encodeParallel(allJobs, 16, (done, total) => {
        process.stdout.write(`\r    gifhero: ${done}/${total} jobs`);
      });
      console.log("");

      for (let j = 0; j < gifs.length; j++) {
        const { fixture, encoder } = jobLabels[j];
        writeFileSync(join(gifsDir, `${fixture}-${encoder}.gif`), gifs[j]);
      }
    }

    // 1b. Batch ALL external encoders via parallel shell commands
    if (externalEncoders.length > 0) {
      console.log(`  Phase 1b: Encoding external (${externalEncoders.length} variants × ${fixtures.length} fixtures)...`);

      // Run 8 concurrent gifski/ffmpeg processes at a time
      const extCmds: Array<{ fixture: string; encoder: string; cmd: string; outputPath: string }> = [];
      for (const fixture of fixtures) {
        const framesDir = join(FIXTURES_DIR, fixture);
        for (const encoderName of externalEncoders) {
          const outputPath = join(gifsDir, `${fixture}-${encoderName}.gif`);
          const res = RESOLUTIONS.find((r) => encoderName === `gifski${r.suffix}`);
          if (res && encoderName.startsWith("gifski")) {
            const widthFlag = res.targetWidth ? `--width ${res.targetWidth} ` : "";
            extCmds.push({
              fixture, encoder: encoderName, outputPath,
              cmd: `gifski --fps 20 ${widthFlag}-o "${outputPath}" "${framesDir}"/*.png 2>/dev/null`,
            });
          }
        }
      }

      for (let batch = 0; batch < extCmds.length; batch += 8) {
        const slice = extCmds.slice(batch, batch + 8);
        const shellCmd = slice.map((c) => c.cmd + " &").join("\n") + "\nwait";
        try {
          execSync(shellCmd, { shell: "/bin/bash", timeout: 300000, stdio: "ignore" });
        } catch {}
        process.stdout.write(`\r    external: ${Math.min(batch + 8, extCmds.length)}/${extCmds.length}`);
      }
      console.log("");
    }

    // 2. Measure all metrics — VMAF in parallel batches via shell
    console.log(`  Phase 2: Measuring metrics...`);

    const allGifs: Array<{ fixture: string; encoder: string; gifPath: string; framesDir: string }> = [];
    for (const fixture of fixtures) {
      const framesDir = join(FIXTURES_DIR, fixture);
      for (const encoderName of available) {
        const gifPath = join(gifsDir, `${fixture}-${encoderName}.gif`);
        if (existsSync(gifPath)) {
          allGifs.push({ fixture, encoder: encoderName, gifPath, framesDir });
        }
      }
    }

    // VMAF in batches of 8 concurrent ffmpeg processes
    const logsDir = join(TEMP_DIR, "logs");
    mkdirSync(logsDir, { recursive: true });

    if (vmafOk) {
      for (let batch = 0; batch < allGifs.length; batch += 8) {
        const slice = allGifs.slice(batch, batch + 8);
        const cmds = slice.map((g) => {
          const fc = countFrames(g.framesDir);
          if (fc < 2) return "true";
          const first = new Image();
          first.src = readFileSync(join(g.framesDir, readdirSync(g.framesDir).filter(f => f.endsWith(".png")).sort()[0]));
          const w = first.width, h = first.height;
          const logPath = join(logsDir, `${g.fixture}-${g.encoder}-vmaf.json`);
          return `ffmpeg -y -framerate 20 -i "${g.framesDir}/%04d.png" -i "${g.gifPath}" ` +
            `-filter_complex "[1:v]scale=${w}:${h}:flags=bicubic[dist];` +
            `[0:v]split=3[r1][r2][r3];[dist]split=3[d1][d2][d3];` +
            `[r1][d1]libvmaf=log_path=${logPath}:log_fmt=json:feature=name=ciede;` +
            `[r2][d2]ssim;[r3][d3]psnr" -f null - 2>/dev/null &`;
        });
        try {
          execSync(cmds.join("\n") + "\nwait", { shell: "/bin/bash", timeout: 600000, stdio: "ignore" });
        } catch {}
        process.stdout.write(`\r    VMAF: ${Math.min(batch + 8, allGifs.length)}/${allGifs.length}`);
      }
      console.log("");
    }

    // 3. Collect all results
    for (const g of allGifs) {
      const fileSize = statSync(g.gifPath).size;
      const frameCount = countFrames(g.framesDir);

      let vmafMean: number | null = null;
      let vmafMin: number | null = null;
      let ciede2000: number | null = null;
      let ssimMean: number | null = null;
      let psnrMean: number | null = null;
      const logPath = join(logsDir, `${g.fixture}-${g.encoder}-vmaf.json`);
      if (existsSync(logPath)) {
        try {
          const data = JSON.parse(readFileSync(logPath, "utf-8"));
          vmafMean = data.pooled_metrics?.vmaf?.mean ?? null;
          vmafMin = data.pooled_metrics?.vmaf?.min ?? null;
          ciede2000 = data.pooled_metrics?.ciede2000?.mean ?? null;
        } catch {}
      }

      // CAMBI (quick, single-GIF no-reference)
      let cambiBanding: number | null = null;
      if (vmafOk) {
        const cambiLog = join(logsDir, `${g.fixture}-${g.encoder}-cambi.json`);
        try {
          execSync(
            `ffmpeg -y -i "${g.gifPath}" ` +
            `-filter_complex "[0:v]split[a][b];[a][b]libvmaf=feature=name=cambi:log_path=${cambiLog}:log_fmt=json" ` +
            `-f null - 2>/dev/null`,
            { timeout: 120000, stdio: "ignore" },
          );
          const d = JSON.parse(readFileSync(cambiLog, "utf-8"));
          cambiBanding = d.pooled_metrics?.cambi?.mean ?? null;
        } catch {}
      }

      // DSSIM
      let dssimMean: number | null = null;
      let dssimMax: number | null = null;
      let dssimP95: number | null = null;
      if (runDssim) {
        const extractDir = join(TEMP_DIR, "frames", `${g.fixture}-${g.encoder}`);
        try {
          extractGifFrames(g.gifPath, extractDir);
          const d = dssimFrames(g.framesDir, extractDir);
          dssimMean = d.mean; dssimMax = d.max; dssimP95 = d.p95;
        } catch {}
      }

      const vmafPerMB = vmafMean !== null ? vmafMean / (fileSize / (1024 * 1024)) : null;

      allResults.push({
        encoder: g.encoder, fixture: g.fixture, fileSize,
        encodingTimeMs: 0, frameCount, gifPath: g.gifPath,
        vmafMean, vmafMin, cambiBanding, ciede2000,
        ssimMean, psnrMean, dssimMean, dssimMax, dssimP95,
        flickerScore: null, vmafPerMB,
      });
    }

    console.log(`  Done — ${allResults.length} results collected.`);

  } else {
    for (const fixture of fixtures) {
      const framesDir = join(FIXTURES_DIR, fixture);
      console.log(`  Benchmarking: ${fixture} (${countFrames(framesDir)} frames)`);

      for (const encoderName of available) {
        process.stdout.write(`    ${encoderName}...`);
        const result = await benchmarkEncoder(
          encoderName, encoders[encoderName].encode,
          fixture, framesDir, vmafOk, runDssim,
        );
        if (result) {
          allResults.push(result);
          console.log(oneLiner(result, vmafOk));
        }
      }
    }
  }

  // Print comparison table
  console.log("\n━━━ Results ━━━");
  printTable(allResults, vmafOk);

  // Save JSON report
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    gitCommit: getGitCommit(),
    results: allResults.map(({ gifPath, ...rest }) => rest),
  };

  const reportName = `${new Date().toISOString().split("T")[0]}-${report.gitCommit || "dev"}.json`;
  const reportPath = join(RESULTS_DIR, reportName);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync(join(RESULTS_DIR, "latest.json"), JSON.stringify(report, null, 2));

  console.log(`\n  Report saved: ${reportPath}`);

  // Copy gifhero and gifski output GIFs to references/
  const refsDir = join(__dirname, "references");
  mkdirSync(refsDir, { recursive: true });
  for (const r of allResults) {
    if ((r.encoder.startsWith("gifhero") || r.encoder.startsWith("gifski")) && existsSync(r.gifPath)) {
      const dest = join(refsDir, `${r.fixture}-${r.encoder}.gif`);
      try { writeFileSync(dest, readFileSync(r.gifPath)); } catch {}
    }
  }

  // Cleanup temp dir (extracted frames, logs) but references are kept
  try {
    // Keep GIFs for visual inspection
    // rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {}

  console.log("");
}

main().catch(console.error);
