import { encode } from "../../src/index.js";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createCanvas, Image } from "canvas";
import { execSync } from "child_process";

const FIXTURES_DIR = "test/fixtures/generated";
const OUT_DIR = "test/bench/results/pipeline-compare";
const CARGO_CMD = "cd packages/gifhero-core && cargo run --release --features cli --example encode_test --";

execSync(`mkdir -p "${OUT_DIR}"`);

const fixtures = [
  "bbb-clip-01", "bbb-clip-05", "candle-flame", "talking-head",
  "screen-recording", "gradient",
];

function loadFrames(dir: string) {
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

console.log("Fixture                | TS size    | Rust size  | Diff    | TS time | Rust time");
console.log("-----------------------|------------|------------|---------|---------|----------");

for (const fixture of fixtures) {
  const dir = join(FIXTURES_DIR, fixture);
  const { width, height, frames } = loadFrames(dir);

  // TS pipeline (same as browser)
  const tsStart = performance.now();
  const tsGif = await encode({ width, height, frames, preset: "balanced" });
  const tsTime = ((performance.now() - tsStart) / 1000).toFixed(1);
  writeFileSync(join(OUT_DIR, `${fixture}-ts.gif`), tsGif);

  // Rust pipeline (same PNGs, no downscale)
  const absDir = join(process.cwd(), dir);
  const rustPath = join(process.cwd(), OUT_DIR, `${fixture}-rust.gif`);
  const rustStart = performance.now();
  execSync(`${CARGO_CMD} "${absDir}" "${rustPath}"`, { timeout: 120000, stdio: "ignore" });
  const rustTime = ((performance.now() - rustStart) / 1000).toFixed(1);
  const rustSize = readFileSync(rustPath).length;

  const diff = ((rustSize / tsGif.byteLength - 1) * 100).toFixed(1);
  const sign = Number(diff) >= 0 ? "+" : "";

  console.log(
    `${fixture.padEnd(23)}| ${(tsGif.byteLength/1024).toFixed(0).padStart(7)} KB | ${(rustSize/1024).toFixed(0).padStart(7)} KB | ${(sign+diff+"%").padStart(7)} | ${tsTime.padStart(5)}s | ${rustTime.padStart(6)}s`
  );
}

console.log(`\nGIF files written to ${OUT_DIR}/`);
console.log("Inspect visually: open *-ts.gif and *-rust.gif side by side.");
