/**
 * DSSIM (Structural Dissimilarity) measurement.
 *
 * Wraps the `dssim` CLI tool by Kornel Lesiński (author of gifski/pngquant).
 * This is the same metric gifski is optimized against.
 *
 * Score: 0.0 = identical, higher = more different
 * Good GIFs: < 0.005, Acceptable: < 0.015, Bad: > 0.030
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";

export interface DssimResult {
  /** Mean DSSIM across all frames */
  mean: number;
  /** Maximum (worst) DSSIM of any single frame */
  max: number;
  /** 95th percentile DSSIM */
  p95: number;
  /** Minimum (best) DSSIM */
  min: number;
  /** Per-frame DSSIM values */
  perFrame: number[];
}

/** Check if dssim CLI is available */
export function isDssimAvailable(): boolean {
  try {
    execSync("command -v dssim", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute DSSIM between two PNG images.
 * Requires `dssim` CLI tool installed.
 */
export function dssimPair(original: string, encoded: string): number {
  if (!existsSync(original)) throw new Error(`File not found: ${original}`);
  if (!existsSync(encoded)) throw new Error(`File not found: ${encoded}`);

  const output = execSync(`dssim "${original}" "${encoded}"`, {
    encoding: "utf-8",
    timeout: 30000,
  });

  // Output format: "0.00234567\tfilename.png"
  const value = parseFloat(output.trim().split("\t")[0]);
  if (isNaN(value)) throw new Error(`Failed to parse dssim output: ${output}`);
  return value;
}

/**
 * Compute DSSIM for all frame pairs between source and encoded directories.
 *
 * @param sourceDir - Directory of original PNG frames (0001.png, 0002.png, ...)
 * @param encodedDir - Directory of GIF-extracted PNG frames
 * @returns Aggregate DSSIM metrics
 */
export function dssimFrames(sourceDir: string, encodedDir: string): DssimResult {
  const sourceFiles = readdirSync(sourceDir)
    .filter((f: string) => f.endsWith(".png"))
    .sort();
  const encodedFiles = readdirSync(encodedDir)
    .filter((f: string) => f.endsWith(".png"))
    .sort();

  const frameCount = Math.min(sourceFiles.length, encodedFiles.length);
  if (frameCount === 0) {
    throw new Error(`No PNG frames found in ${sourceDir} or ${encodedDir}`);
  }

  const values: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const sourcePath = `${sourceDir}/${sourceFiles[i]}`;
    const encodedPath = `${encodedDir}/${encodedFiles[i]}`;
    values.push(dssimPair(sourcePath, encodedPath));
  }

  values.sort((a, b) => a - b);

  return {
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    max: values[values.length - 1],
    min: values[0],
    p95: values[Math.floor(values.length * 0.95)],
    perFrame: values,
  };
}

/**
 * Extract GIF frames to a temp directory as PNGs using ffmpeg.
 * Returns the path to the directory of extracted frames.
 */
export function extractGifFrames(gifPath: string, outDir: string): string {
  mkdirSync(outDir, { recursive: true });

  execSync(
    `ffmpeg -y -i "${gifPath}" -vsync 0 "${outDir}/%04d.png"`,
    { stdio: "ignore", timeout: 60000 }
  );

  return outDir;
}
