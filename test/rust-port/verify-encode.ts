/**
 * Run the TS encode pipeline on a fixture and write the GIF for comparison.
 *
 * Usage: npx tsx test/rust-port/verify-encode.ts [fixture-name] [target-width]
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { encode } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/generated");

function loadFrames(
  fixtureDir: string,
  maxFrames: number = 100,
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

async function main() {
  const fixtureName = process.argv[2] || "bbb-clip-01";
  const targetWidth = process.argv[3] ? parseInt(process.argv[3]) : undefined;

  const dir = join(fixturesDir, fixtureName);
  const { frames, width, height } = loadFrames(dir);

  console.log(`Loaded ${frames.length} frames (${width}x${height})`);

  const encodeFrames = frames.map((data) => ({ data, delay: 50 }));

  const start = Date.now();
  const gif = await encode({
    frames: encodeFrames,
    width,
    height,
    preset: "balanced",
    targetWidth,
  });
  const elapsed = Date.now() - start;

  const outPath = join(
    __dirname,
    `ts-${fixtureName}${targetWidth ? `-${targetWidth}` : ""}.gif`,
  );
  writeFileSync(outPath, gif);

  console.log(
    `Encoded ${frames.length} frames → ${gif.length} bytes (${(gif.length / 1024).toFixed(1)} KB) in ${(elapsed / 1000).toFixed(2)}s`,
  );
  console.log(`Output: ${outPath}`);
}

main().catch(console.error);
