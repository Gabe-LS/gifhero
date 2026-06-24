/**
 * Verify Rust probe output against TypeScript probe.
 *
 * Loads real fixture frames, runs the TS probeFrames(), and prints
 * results as JSON for comparison against the Rust implementation.
 *
 * Usage: npx tsx test/rust-port/verify-probe.ts [fixture-name]
 */

import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { probeFrames } from "../../src/probe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/generated");

function loadFrames(
  fixtureDir: string,
  maxFrames: number = 30,
): { frames: Uint8ClampedArray[]; width: number; height: number } {
  const files = readdirSync(fixtureDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .slice(0, maxFrames);

  const frames: Uint8ClampedArray[] = [];
  let width = 0;
  let height = 0;

  for (const file of files) {
    const img = new Image();
    img.src = readFileSync(join(fixtureDir, file));
    width = img.width;
    height = img.height;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    frames.push(ctx.getImageData(0, 0, width, height).data);
  }

  return { frames, width, height };
}

const fixtureName = process.argv[2];
const fixtures = fixtureName
  ? [fixtureName]
  : ["bbb-clip-01", "bbb-clip-05"];

for (const name of fixtures) {
  const dir = join(fixturesDir, name);
  const { frames, width, height } = loadFrames(dir);

  const result = probeFrames(frames, width, height, 3);

  const staticCount = result.staticMask.reduce(
    (sum, v) => sum + v,
    0,
  );

  const output = {
    fixture: name,
    frameCount: frames.length,
    width,
    height,
    staticMaskPixelCount: staticCount,
    staticMaskTotalPixels: width * height,
    staticFraction: result.staticFraction,
    motionLevel: result.motionLevel,
    colorComplexity: result.colorComplexity,
    sceneChanges: result.sceneChanges,
    perFrameMotionSample: result.perFrameMotion.slice(0, 10),
  };

  console.log(JSON.stringify(output, null, 2));
}
