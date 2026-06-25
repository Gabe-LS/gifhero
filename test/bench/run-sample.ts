/**
 * Configurable benchmark runner.
 *
 * Usage:
 *   npx tsx test/bench/run-sample.ts [options]
 *
 * Options:
 *   --fixtures <names>      Comma-separated fixture names [default: all]
 *   --resolutions <widths>  Comma-separated target widths, 0=native [default: 0]
 *   --encoders <names>      Comma-separated encoder names [default: all]
 *   --metrics <names>       Comma-separated: vmaf,ssim,psnr,ciede,cambi,dssim,tfs [default: all]
 *   --gifs-dir <path>       Output directory for GIF files [default: test/bench/results/gifs]
 *   --results-dir <path>    Output directory for JSON results [default: test/bench/results]
 *   --list                  List available fixtures and encoders, then exit
 *   --keep-gifs             Don't delete GIFs after benchmarking
 *
 * Examples:
 *   npx tsx test/bench/run-sample.ts --fixtures bbb-clip-01,candle-flame --encoders gifhero-balanced,gifski
 *   npx tsx test/bench/run-sample.ts --resolutions 0,360,240 --metrics vmaf,ssim
 *   npx tsx test/bench/run-sample.ts --fixtures talking-head --encoders gifhero-balanced,gifski,ffmpeg --gifs-dir /tmp/gifs
 */

import { execSync } from "child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { isDssimAvailable, dssimFrames, extractGifFrames } from "../metrics/dssim.js";
import { computeFlickerScore } from "../metrics/flicker.js";
import { encode } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");

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

type EncoderFn = (framesDir: string, outputPath: string, targetWidth?: number) => void | Promise<void>;

const ALL_ENCODERS: Record<string, { available: () => boolean; encode: EncoderFn }> = {
  "gifhero-balanced": {
    available: () => true,
    encode: async (framesDir, outputPath, targetWidth) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      const tw = targetWidth && targetWidth < width ? targetWidth : undefined;
      writeFileSync(outputPath, await encode({
        width, height, frames, preset: "balanced",
        ...(tw ? { targetWidth: tw } : {}),
      }));
    },
  },
  "gifhero-quality": {
    available: () => true,
    encode: async (framesDir, outputPath, targetWidth) => {
      const { width, height, frames } = loadPngFrames(framesDir);
      const tw = targetWidth && targetWidth < width ? targetWidth : undefined;
      writeFileSync(outputPath, await encode({
        width, height, frames, preset: "quality",
        ...(tw ? { targetWidth: tw } : {}),
      }));
    },
  },
  "gifski": {
    available: () => hasCommand("gifski"),
    encode: (framesDir, outputPath, targetWidth) => {
      const wFlag = targetWidth ? `--width ${targetWidth} ` : "";
      execSync(`gifski --fps 20 ${wFlag}-o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" });
    },
  },
  "gifski-lossy": {
    available: () => hasCommand("gifski"),
    encode: (framesDir, outputPath, targetWidth) => {
      const wFlag = targetWidth ? `--width ${targetWidth} ` : "";
      execSync(`gifski --fps 20 --quality 80 --lossy-quality 60 ${wFlag}-o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" });
    },
  },
  "ffmpeg": {
    available: () => hasCommand("ffmpeg"),
    encode: (framesDir, outputPath, targetWidth) => {
      const scale = targetWidth ? `scale=${targetWidth}:-1:flags=lanczos,` : "";
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scale}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle" "${outputPath}"`,
        { stdio: "ignore", timeout: 120000 });
    },
  },
  "ffmpeg-hq": {
    available: () => hasCommand("ffmpeg"),
    encode: (framesDir, outputPath, targetWidth) => {
      const scale = targetWidth ? `scale=${targetWidth}:-1:flags=lanczos,` : "";
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scale}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=single[p];[s1][p]paletteuse=new=1:dither=floyd_steinberg:diff_mode=rectangle" "${outputPath}"`,
        { stdio: "ignore", timeout: 120000 });
    },
  },
  "magick": {
    available: () => hasCommand("magick"),
    encode: (framesDir, outputPath, targetWidth) => {
      const resize = targetWidth ? `-resize ${targetWidth}x` : "";
      execSync(
        `magick -delay 5 -loop 0 "${framesDir}/"*.png ${resize} -dither FloydSteinberg -colors 256 -coalesce -layers OptimizePlus -layers OptimizeTransparency "${outputPath}"`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" });
    },
  },
  "ffmpeg+gifsicle": {
    available: () => hasCommand("ffmpeg") && hasCommand("gifsicle"),
    encode: (framesDir, outputPath, targetWidth) => {
      const scale = targetWidth ? `scale=${targetWidth}:-1:flags=lanczos,` : "";
      const tmp = outputPath + ".tmp.gif";
      execSync(
        `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -vf "${scale}split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=full[p];[s1][p]paletteuse=dither=floyd_steinberg:diff_mode=rectangle" "${tmp}"`,
        { stdio: "ignore", timeout: 120000 });
      execSync(`gifsicle -O3 --lossy=80 --color-method=median-cut "${tmp}" -o "${outputPath}"`,
        { stdio: "ignore", timeout: 60000 });
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

function inspectGif(gifPath: string, canvasW: number, canvasH: number): GifInspection | null {
  if (!hasCommand("gifsicle")) return null;
  try {
    const out = execSync(`gifsicle --sinfo "${gifPath}" 2>&1`, { encoding: "utf-8", timeout: 10000 });
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
      if (dispMatch) {
        const d = dispMatch[1];
        disposals[d] = (disposals[d] || 0) + 1;
      }

      const commentMatch = line.match(/comment (.+)/);
      if (commentMatch) comments.push(commentMatch[1].trim());
    }

    const w = logicalWidth || canvasW;
    const h = logicalHeight || canvasH;
    const canvasPixels = w * h;
    const fullFrames = frameDims.filter(d => d.w * d.h >= canvasPixels * 0.95).length;
    const subFrames = frameDims.filter(d => d.w * d.h < canvasPixels * 0.95);
    const subCoverages = subFrames.map(d => (d.w * d.h) / canvasPixels);
    const avgCoverage = subCoverages.length > 0
      ? subCoverages.reduce((s, c) => s + c, 0) / subCoverages.length : 0;
    const minCoverage = subCoverages.length > 0 ? Math.min(...subCoverages) : 0;

    const totalCompressed = compressedSizes.reduce((a, b) => a + b, 0);
    const totalDuration = frameDelays.reduce((a, b) => a + b, 0);
    const uniqueDelays = [...new Set(frameDelays)];

    return {
      frameCount: frameDims.length,
      logicalWidth: w,
      logicalHeight: h,
      hasGlobalColorTable: hasGCT,
      globalColorTableSize: gctSize,
      minPaletteSize: paletteSizes.length > 0 ? Math.min(...paletteSizes) : 0,
      maxPaletteSize: paletteSizes.length > 0 ? Math.max(...paletteSizes) : 0,
      avgPaletteSize: paletteSizes.length > 0 ? Math.round(paletteSizes.reduce((a, b) => a + b, 0) / paletteSizes.length) : 0,
      avgFrameCompressedBytes: compressedSizes.length > 0 ? Math.round(compressedSizes.reduce((a, b) => a + b, 0) / compressedSizes.length) : 0,
      minFrameCompressedBytes: compressedSizes.length > 0 ? Math.min(...compressedSizes) : 0,
      maxFrameCompressedBytes: compressedSizes.length > 0 ? Math.max(...compressedSizes) : 0,
      totalCompressedBytes: totalCompressed,
      fullFrameCount: fullFrames,
      subFrameCount: subFrames.length,
      avgSubFrameCoverage: Math.round(avgCoverage * 1000) / 1000,
      minSubFrameCoverage: Math.round(minCoverage * 1000) / 1000,
      transparentFrameCount: transparentCount,
      delays: uniqueDelays,
      avgDelay: frameDelays.length > 0 ? Math.round(frameDelays.reduce((a, b) => a + b, 0) / frameDelays.length * 1000) / 1000 : 0,
      minDelay: frameDelays.length > 0 ? Math.min(...frameDelays) : 0,
      maxDelay: frameDelays.length > 0 ? Math.max(...frameDelays) : 0,
      constantDelay: uniqueDelays.length <= 1,
      disposalMethods: disposals,
      loopCount,
      comments,
      interlaced,
      durationSeconds: Math.round(totalDuration * 100) / 100,
      effectiveFps: totalDuration > 0 ? Math.round(frameDims.length / totalDuration * 10) / 10 : 0,
      bitsPerPixel: frameDims.length > 0 ? Math.round(totalCompressed * 8 / (frameDims.length * w * h) * 10000) / 10000 : 0,
    };
  } catch {
    return null;
  }
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
      `ffmpeg -y -framerate 20 -i "${framesDir}/%04d.png" -i "${gifPath}" ` +
      `-filter_complex "[1:v]scale=${w}:${h}:flags=bicubic[dist];` +
      `[0:v]split=3[r1][r2][r3];[dist]split=3[d1][d2][d3];` +
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

// ── Main ──

async function main() {
  // Parse config
  const allFixtures = getAllFixtures();
  const fixtureArg = parseArg("fixtures", "");
  const fixtures = fixtureArg ? fixtureArg.split(",") : allFixtures;

  const resArg = parseArg("resolutions", "0");
  const resolutions = resArg.split(",").map(Number); // 0 = native

  const encoderArg = parseArg("encoders", "");
  const requestedEncoders = encoderArg ? encoderArg.split(",") : Object.keys(ALL_ENCODERS);
  const availableEncoders = requestedEncoders.filter(n => ALL_ENCODERS[n]?.available());

  const metricArg = parseArg("metrics", "vmaf,ssim,psnr,ciede,cambi,dssim,tfs");
  const enabledMetrics = new Set(metricArg.split(","));

  const gifsDir = parseArg("gifs-dir", join(__dirname, "results", "gifs"));
  const resultsDir = parseArg("results-dir", join(__dirname, "results"));
  const keepGifs = hasFlag("keep-gifs");

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
  const TEMP_DIR = join(__dirname, ".tmp-sample");

  mkdirSync(TEMP_DIR, { recursive: true });
  mkdirSync(gifsDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });
  const logsDir = join(TEMP_DIR, "logs"); mkdirSync(logsDir, { recursive: true });
  const framesExtractDir = join(TEMP_DIR, "frames"); mkdirSync(framesExtractDir, { recursive: true });

  const totalJobs = fixtures.length * resolutions.length * availableEncoders.length;

  console.log("\n━━━ gifhero benchmark ━━━\n");
  console.log(`  Fixtures:     ${fixtures.join(", ")}`);
  console.log(`  Resolutions:  ${resolutions.map(r => r === 0 ? "native" : r + "p").join(", ")}`);
  console.log(`  Encoders:     ${availableEncoders.join(", ")}`);
  console.log(`  Metrics:      ${[...enabledMetrics].join(", ")}`);
  console.log(`  GIFs dir:     ${gifsDir}`);
  console.log(`  Results dir:  ${resultsDir}`);
  console.log(`  Total jobs:   ${totalJobs}`);
  console.log(`  VMAF: ${vmafOk ? "yes" : "no"}  DSSIM: ${dssimOk ? "yes" : "no"}`);
  console.log("");

  const results: any[] = [];
  let completed = 0;

  for (const fixture of fixtures) {
    const srcDir = join(FIXTURES_DIR, fixture);
    const frameCount = readdirSync(srcDir).filter(f => f.endsWith(".png")).length;
    const firstImg = new Image();
    firstImg.src = readFileSync(join(srcDir, readdirSync(srcDir).filter(f => f.endsWith(".png")).sort()[0]));
    const nativeW = firstImg.width, nativeH = firstImg.height;

    for (const res of resolutions) {
      const targetWidth = res === 0 ? undefined : res;
      const resSuffix = res === 0 ? "" : `-${res}p`;
      const outW = targetWidth && targetWidth < nativeW ? targetWidth : nativeW;
      const outH = targetWidth && targetWidth < nativeW ? Math.round(nativeH * outW / nativeW) : nativeH;

      console.log(`  ${fixture}${resSuffix} (${frameCount} frames, ${outW}x${outH})`);

      for (const encName of availableEncoders) {
        const outputPath = join(gifsDir, `${fixture}${resSuffix}-${encName}.gif`);

        // Encode + time
        const t0 = performance.now();
        try {
          await ALL_ENCODERS[encName].encode(srcDir, outputPath, targetWidth);
        } catch (err) {
          console.log(`    ✗ ${encName}: FAILED — ${(err as Error).message}`);
          continue;
        }
        const encTime = Math.round(performance.now() - t0);

        if (!existsSync(outputPath)) { console.log(`    ✗ ${encName}: no output`); continue; }
        const fileSize = statSync(outputPath).size;
        completed++;

        // GIF structural inspection
        const inspection = inspectGif(outputPath, outW, outH);

        // Quality metrics
        const r: any = {
          fixture, resolution: res === 0 ? "native" : `${res}p`,
          encoder: encName, fileSize, encodingTimeMs: encTime, frameCount,
          outputWidth: outW, outputHeight: outH,
          // GIF structure
          ...(inspection ? { gif: inspection } : {}),
        };

        // Extract GIF frames (needed for DSSIM and TFS)
        const extractDir = join(framesExtractDir, `${fixture}${resSuffix}-${encName}`);
        let framesExtracted = false;
        if (enabledMetrics.has("dssim") || enabledMetrics.has("tfs")) {
          try { extractGifFrames(outputPath, extractDir); framesExtracted = true; } catch {}
        }

        // VMAF + SSIM + PSNR + CIEDE + CAMBI (one ffmpeg pass)
        const needsVmaf = ["vmaf", "ssim", "psnr", "ciede", "cambi"].some(m => enabledMetrics.has(m));
        if (needsVmaf && vmafOk) {
          try {
            const vm = computeVmafMetrics(srcDir, outputPath, outW, outH, logsDir);
            if (enabledMetrics.has("vmaf")) { r.vmafMean = vm.vmafMean; r.vmafMin = vm.vmafMin; }
            if (enabledMetrics.has("ssim")) r.ssimMean = vm.ssim;
            if (enabledMetrics.has("psnr")) r.psnrMean = vm.psnr;
            if (enabledMetrics.has("ciede")) r.ciede2000 = vm.ciede;
            if (enabledMetrics.has("cambi")) r.cambiBanding = vm.cambi;
          } catch {}
        }

        // DSSIM
        if (enabledMetrics.has("dssim") && dssimOk && framesExtracted) {
          try {
            const d = dssimFrames(srcDir, extractDir);
            r.dssimMean = d.mean; r.dssimMax = d.max; r.dssimP95 = d.p95;
          } catch {}
        }

        // TFS
        if (enabledMetrics.has("tfs") && framesExtracted && frameCount >= 2) {
          try {
            const srcPngs = readdirSync(srcDir).filter(f => f.endsWith(".png")).sort();
            const extPngs = readdirSync(extractDir).filter(f => f.endsWith(".png")).sort();
            const count = Math.min(srcPngs.length, extPngs.length);
            const srcFrames: Uint8ClampedArray[] = [], encFrames: Uint8ClampedArray[] = [];
            for (let i = 0; i < count; i++) {
              const s = new Image(); s.src = readFileSync(join(srcDir, srcPngs[i]));
              const sc = createCanvas(outW, outH); sc.getContext("2d").drawImage(s, 0, 0, outW, outH);
              srcFrames.push(sc.getContext("2d").getImageData(0, 0, outW, outH).data);
              const e = new Image(); e.src = readFileSync(join(extractDir, extPngs[i]));
              const ec = createCanvas(outW, outH); ec.getContext("2d").drawImage(e, 0, 0, outW, outH);
              encFrames.push(ec.getContext("2d").getImageData(0, 0, outW, outH).data);
            }
            r.flickerScore = computeFlickerScore(srcFrames, encFrames, outW, outH).score;
          } catch {}
        }

        results.push(r);

        const sizeKB = (fileSize / 1024).toFixed(0);
        const vmafStr = r.vmafMean != null ? `VMAF ${r.vmafMean.toFixed(1)}` : "";
        const subInfo = inspection
          ? `sub:${inspection.subFrameCount}/${inspection.frameCount} cov:${(inspection.avgSubFrameCoverage * 100).toFixed(0)}% pal:${inspection.minPaletteSize}-${inspection.maxPaletteSize} bpp:${inspection.bitsPerPixel} ${inspection.effectiveFps}fps`
          : "";
        const pct = `[${completed}/${totalJobs}]`;
        console.log(`    ${encName}: ${sizeKB} KB, ${vmafStr ? vmafStr + ", " : ""}${encTime}ms, ${subInfo} ${pct}`);
      }
    }
    console.log("");
  }

  // Save results
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const outPath = join(resultsDir, `bench-${timestamp}.json`);
  writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), config: {
    fixtures, resolutions: resolutions.map(r => r === 0 ? "native" : `${r}p`),
    encoders: availableEncoders, metrics: [...enabledMetrics],
  }, results }, null, 2));
  console.log(`Results: ${outPath}`);

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

  // Cleanup
  rmSync(TEMP_DIR, { recursive: true, force: true });
  if (!keepGifs) {
    console.log(`\nGIFs cleaned. Use --keep-gifs to retain them.`);
    rmSync(gifsDir, { recursive: true, force: true });
  } else {
    console.log(`\nGIFs saved to ${gifsDir}`);
  }
}

main().catch(console.error);
