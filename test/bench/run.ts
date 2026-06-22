/**
 * gifhero benchmark runner
 *
 * Encodes every test fixture with every available encoder,
 * measures quality metrics, and outputs a comparison table.
 *
 * Run: npm run bench
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { isDssimAvailable, dssimFrames, extractGifFrames } from "../metrics/dssim";
import { encode } from "../../src/index";

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");
const RESULTS_DIR = join(__dirname, "results");
const TEMP_DIR = join(__dirname, ".tmp");
const REFS_DIR = join(__dirname, "references");

interface EncoderResult {
  encoder: string;
  fixture: string;
  fileSize: number;
  encodingTimeMs: number;
  dssimMean: number | null;
  dssimMax: number | null;
  dssimP95: number | null;
  frameCount: number;
  gifPath: string;
}

interface BenchmarkReport {
  timestamp: string;
  gitCommit: string | null;
  results: EncoderResult[];
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
      // First encode with ffmpeg
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
      // Then optimize with gifsicle
      execSync(
        `gifsicle -O3 --lossy=80 "${tmpGif}" -o "${outputPath}"`,
        { stdio: "ignore", timeout: 60000 }
      );
      try { execSync(`rm "${palettePath}" "${tmpGif}"`, { stdio: "ignore" }); } catch {}
    },
  },

  gifhero: {
    available: () => true,
    encode: (framesDir, outputPath, frameCount) => {
      const files = readdirSync(framesDir)
        .filter((f: string) => f.endsWith(".png"))
        .sort();

      let width = 0;
      let height = 0;
      const frames: Array<{ data: Uint8ClampedArray; delay: number }> = [];

      for (const file of files) {
        const img = new Image();
        img.src = readFileSync(join(framesDir, file));
        if (width === 0) { width = img.width; height = img.height; }
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        frames.push({
          data: ctx.getImageData(0, 0, img.width, img.height).data,
          delay: 50,
        });
      }

      const gif = encode({ width, height, frames, quality: 10 });
      writeFileSync(outputPath, gif);
    },
  },
};

// ─────────────────────────────────────────────
// Benchmark logic
// ─────────────────────────────────────────────

function getFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];

  return readdirSync(FIXTURES_DIR)
    .filter((name) => {
      const dir = join(FIXTURES_DIR, name);
      if (!statSync(dir).isDirectory()) return false;
      const pngs = readdirSync(dir).filter((f) => f.endsWith(".png"));
      return pngs.length >= 2; // Need at least 2 frames for animation
    })
    .sort();
}

function countFrames(dir: string): number {
  return readdirSync(dir).filter((f) => f.endsWith(".png")).length;
}

async function benchmarkEncoder(
  encoderName: string,
  encodeFn: EncoderFn,
  fixtureName: string,
  framesDir: string
): Promise<EncoderResult | null> {
  const outputDir = join(TEMP_DIR, "gifs");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${fixtureName}-${encoderName}.gif`);
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

  // Compute DSSIM
  let dssimMean: number | null = null;
  let dssimMax: number | null = null;
  let dssimP95: number | null = null;

  if (isDssimAvailable()) {
    try {
      const extractDir = join(TEMP_DIR, "frames", `${fixtureName}-${encoderName}`);
      extractGifFrames(outputPath, extractDir);
      const dssim = dssimFrames(framesDir, extractDir);
      dssimMean = dssim.mean;
      dssimMax = dssim.max;
      dssimP95 = dssim.p95;
    } catch (err) {
      console.error(`    ⚠ DSSIM failed: ${(err as Error).message}`);
    }
  }

  return {
    encoder: encoderName,
    fixture: fixtureName,
    fileSize,
    encodingTimeMs,
    dssimMean,
    dssimMax,
    dssimP95,
    frameCount,
    gifPath: outputPath,
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

function formatDssim(v: number | null): string {
  if (v === null) return "  n/a  ";
  return v.toFixed(5).padStart(7);
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printTable(results: EncoderResult[]) {
  // Group by fixture
  const fixtures = [...new Set(results.map((r) => r.fixture))];

  for (const fixture of fixtures) {
    const rows = results
      .filter((r) => r.fixture === fixture)
      .sort((a, b) => (a.dssimMean ?? 999) - (b.dssimMean ?? 999));

    console.log("");
    console.log(`  ┌─ ${fixture} (${rows[0]?.frameCount ?? "?"} frames) ─────────────`);
    console.log(
      "  │ " +
      "Encoder".padEnd(20) +
      "DSSIM".padStart(8) +
      "P95".padStart(8) +
      "Size".padStart(8) +
      "Time".padStart(8)
    );
    console.log("  │ " + "─".repeat(52));

    for (const row of rows) {
      console.log(
        "  │ " +
        row.encoder.padEnd(20) +
        formatDssim(row.dssimMean) +
        " " +
        formatDssim(row.dssimP95) +
        formatSize(row.fileSize).padStart(8) +
        formatTime(row.encodingTimeMs).padStart(8)
      );
    }
    console.log("  └" + "─".repeat(54));
  }
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────

async function main() {
  console.log("");
  console.log("━━━ gifhero benchmark ━━━");
  console.log("");

  // Clean temp directory
  mkdirSync(TEMP_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  const fixtures = getFixtures();
  if (fixtures.length === 0) {
    console.error("No fixtures found. Run: npm run bench:setup");
    process.exit(1);
  }

  console.log(`Fixtures: ${fixtures.join(", ")}`);
  console.log(`DSSIM: ${isDssimAvailable() ? "available" : "not installed (brew install dssim)"}`);

  // Check which encoders are available
  const available = Object.entries(encoders)
    .filter(([, e]) => e.available())
    .map(([name]) => name);

  console.log(`Encoders: ${available.length > 0 ? available.join(", ") : "none found!"}`);

  if (available.length === 0) {
    console.error("Install at least one: brew install gifski ffmpeg gifsicle");
    process.exit(1);
  }

  console.log("");

  // Run benchmarks
  const allResults: EncoderResult[] = [];

  for (const fixture of fixtures) {
    const framesDir = join(FIXTURES_DIR, fixture);
    console.log(`  Benchmarking: ${fixture} (${countFrames(framesDir)} frames)`);

    for (const encoderName of available) {
      process.stdout.write(`    ${encoderName}...`);
      const result = await benchmarkEncoder(
        encoderName,
        encoders[encoderName].encode,
        fixture,
        framesDir
      );
      if (result) {
        allResults.push(result);
        console.log(
          ` ${formatDssim(result.dssimMean)} DSSIM, ` +
          `${formatSize(result.fileSize)}, ` +
          `${formatTime(result.encodingTimeMs)}`
        );
      }
    }
  }

  // Print comparison table
  console.log("\n━━━ Results ━━━");
  printTable(allResults);

  // Save JSON report
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    gitCommit: getGitCommit(),
    results: allResults.map(({ gifPath, ...rest }) => ({ ...rest, gifPath })),
  };

  const reportName = `${new Date().toISOString().split("T")[0]}-${report.gitCommit || "dev"}.json`;
  const reportPath = join(RESULTS_DIR, reportName);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync(join(RESULTS_DIR, "latest.json"), JSON.stringify(report, null, 2));

  console.log(`\n  Report saved: ${reportPath}`);

  // Cleanup
  try {
    execSync(`rm -rf "${TEMP_DIR}"`, { stdio: "ignore" });
  } catch {}

  console.log("");
}

main().catch(console.error);
