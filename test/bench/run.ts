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

const encoders: Record<string, { available: () => boolean; encode: EncoderFn }> = {
  gifski: {
    available: () => hasCommand("gifski"),
    encode: (framesDir, outputPath) => {
      execSync(
        `gifski --fps 20 --width 480 --quality 100 -o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" }
      );
    },
  },

  "ffmpeg-palettegen": {
    available: () => hasCommand("ffmpeg"),
    encode: (framesDir, outputPath) => {
      const palettePath = outputPath.replace(".gif", "-palette.png");
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" ` +
        `-vf "palettegen=stats_mode=diff:max_colors=256" "${palettePath}"`,
        { stdio: "ignore", timeout: 60000 }
      );
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -i "${palettePath}" ` +
        `-lavfi "paletteuse=dither=floyd_steinberg:diff_mode=rectangle" "${outputPath}"`,
        { stdio: "ignore", timeout: 60000 }
      );
      try { execSync(`rm "${palettePath}"`, { stdio: "ignore" }); } catch {}
    },
  },

  "ffmpeg+gifsicle": {
    available: () => hasCommand("ffmpeg") && hasCommand("gifsicle"),
    encode: (framesDir, outputPath) => {
      const tmpGif = outputPath.replace(".gif", "-tmp.gif");
      const palettePath = outputPath.replace(".gif", "-palette.png");
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" ` +
        `-vf "palettegen=stats_mode=diff" "${palettePath}"`,
        { stdio: "ignore", timeout: 60000 }
      );
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -i "${palettePath}" ` +
        `-lavfi "paletteuse=dither=floyd_steinberg" "${tmpGif}"`,
        { stdio: "ignore", timeout: 60000 }
      );
      execSync(
        `gifsicle -O3 --lossy=80 "${tmpGif}" -o "${outputPath}"`,
        { stdio: "ignore", timeout: 60000 }
      );
      try { execSync(`rm "${palettePath}" "${tmpGif}"`, { stdio: "ignore" }); } catch {}
    },
  },

  "gifhero-quality": {
    available: () => true,
    encode: async (framesDir, outputPath) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      writeFileSync(outputPath, await encode({ width, height, frames, preset: "quality" }));
    },
  },

  "gifhero-balanced": {
    available: () => true,
    encode: async (framesDir, outputPath) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      writeFileSync(outputPath, await encode({ width, height, frames, preset: "balanced" }));
    },
  },

  "gifhero-speed": {
    available: () => true,
    encode: async (framesDir, outputPath) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      writeFileSync(outputPath, await encode({ width, height, frames, preset: "speed" }));
    },
  },
};

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
const FAST_ENCODERS = new Set([
  "gifski", "gifhero-quality", "gifhero-balanced", "gifhero-speed",
]);

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

  async function benchFixture(fixture: string) {
    const framesDir = join(FIXTURES_DIR, fixture);
    if (!PARALLEL_MODE) console.log(`  Benchmarking: ${fixture} (${countFrames(framesDir)} frames)`);
    const results: EncoderResult[] = [];

    for (const encoderName of available) {
      if (!PARALLEL_MODE) process.stdout.write(`    ${encoderName}...`);
      const result = await benchmarkEncoder(
        encoderName,
        encoders[encoderName].encode,
        fixture,
        framesDir,
        vmafOk,
        runDssim
      );
      if (result) {
        results.push(result);
        if (!PARALLEL_MODE) console.log(oneLiner(result, vmafOk));
      }
    }
    return results;
  }

  if (PARALLEL_MODE) {
    console.log(`  Running ${fixtures.length} fixtures in parallel...`);
    const batches = await Promise.all(fixtures.map((f) => benchFixture(f)));
    for (const batch of batches) allResults.push(...batch);
    console.log(`  Done — ${allResults.length} results collected.`);
  } else {
    for (const fixture of fixtures) {
      const results = await benchFixture(fixture);
      allResults.push(...results);
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
    if ((r.encoder.startsWith("gifhero") || r.encoder === "gifski") && existsSync(r.gifPath)) {
      const dest = join(refsDir, `${r.fixture}-${r.encoder}.gif`);
      try { writeFileSync(dest, readFileSync(r.gifPath)); } catch {}
    }
  }

  // Cleanup temp dir (extracted frames, logs) but references are kept
  try {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {}

  console.log("");
}

main().catch(console.error);
