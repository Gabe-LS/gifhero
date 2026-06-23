/**
 * Exhaustive parameter sweep for gifhero.
 *
 * Stage 1: Full grid on big-buck-bunny (~8-11k combos)
 * Stage 2: Precision refinement around Pareto winners
 * Stage 3: Cross-fixture validation on all fixtures
 * Stage 4: Report generation
 *
 * Run:  npx tsx test/bench/sweep-exhaustive.ts
 * Dry:  npx tsx test/bench/sweep-exhaustive.ts --dry-run
 */

import { execSync } from "child_process";
import {
  existsSync, mkdirSync, readFileSync, readdirSync,
  writeFileSync, rmSync, statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createCanvas, Image } from "canvas";
import { encodeParallel } from "./parallel.js";
import type { EncodeJob } from "./parallel.js";
import type { EncodeOptions, OptimizeOptions } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "generated");
const REFS_DIR = join(__dirname, "references");
const RESULTS_DIR = join(__dirname, "results");
const TEMP_DIR = join(__dirname, ".tmp-sweep");
const DRY_RUN = process.argv.includes("--dry-run");
const CONCURRENCY = 16;

// ── Types ───────────────────────────────────────────────────────

interface SweepConfig {
  quantizer: "imagequant" | "neuquant";
  palette: "local" | "global" | "crossframe";
  maxColors: number;
  imagequantQuality: number;
  imagequantSpeed: number;
  neuquantQuality: number;
  lossyLzw: number;
  holeTolerance: number;
  dither: "floyd-steinberg" | false;
  temporalDither: boolean;
  temporalWeight: number;
  probeTolerance: number;
  staleThreshold: number;
}

interface SweepResult {
  config: SweepConfig;
  fileSize: number;
  vmafMean: number | null;
  encodingTimeMs: number;
}

// ── Helpers ─────────────────────────────────────────────────────

function loadPngFrames(dir: string) {
  const files = readdirSync(dir).filter((f: string) => f.endsWith(".png")).sort();
  let width = 0, height = 0;
  const frames: Array<{ data: Uint8ClampedArray; delay: number }> = [];
  for (const file of files) {
    const img = new Image();
    img.src = readFileSync(join(dir, file));
    if (!width) { width = img.width; height = img.height; }
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    frames.push({ data: ctx.getImageData(0, 0, img.width, img.height).data, delay: 50 });
  }
  return { width, height, frames };
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function computeVmaf(
  sourceDir: string, gifPath: string, w: number, h: number,
): number | null {
  const logPath = gifPath.replace(".gif", "-vmaf.json");
  try {
    execSync(
      `ffmpeg -y -framerate 20 -i "${sourceDir}/%04d.png" -i "${gifPath}" ` +
      `-filter_complex "[1:v]scale=${w}:${h}:flags=bicubic[d];` +
      `[0:v][d]libvmaf=log_path=${logPath}:log_fmt=json" -f null - 2>&1`,
      { encoding: "utf-8", timeout: 300000 },
    );
    const v = JSON.parse(readFileSync(logPath, "utf-8")).pooled_metrics?.vmaf?.mean;
    try { rmSync(logPath); } catch {}
    return v ?? null;
  } catch { return null; }
}

function computeVmafBatch(
  sourceDir: string, gifPaths: string[], w: number, h: number,
  concurrency: number = 8,
): Array<number | null> {
  const results = new Array<number | null>(gifPaths.length).fill(null);

  for (let batchStart = 0; batchStart < gifPaths.length; batchStart += concurrency) {
    const batch = gifPaths.slice(batchStart, batchStart + concurrency);
    const cmds = batch.map((gifPath) => {
      const logPath = gifPath.replace(".gif", "-vmaf.json");
      return `ffmpeg -y -framerate 20 -i "${sourceDir}/%04d.png" -i "${gifPath}" ` +
        `-filter_complex "[1:v]scale=${w}:${h}:flags=bicubic[d];` +
        `[0:v][d]libvmaf=log_path=${logPath}:log_fmt=json" -f null - 2>/dev/null &`;
    });
    try {
      execSync(cmds.join("\n") + "\nwait", { shell: "/bin/bash", timeout: 300000, stdio: "ignore" });
    } catch {}

    for (let j = 0; j < batch.length; j++) {
      const logPath = batch[j].replace(".gif", "-vmaf.json");
      try {
        const v = JSON.parse(readFileSync(logPath, "utf-8")).pooled_metrics?.vmaf?.mean;
        results[batchStart + j] = v ?? null;
        rmSync(logPath);
      } catch {}
    }
  }

  return results;
}

function configToOptions(c: SweepConfig): Omit<EncodeOptions, "width" | "height" | "frames"> {
  const optimize: OptimizeOptions = {
    subframe: true,
    holeTolerance: c.holeTolerance,
    transparencyEqualization: true,
    staleThreshold: c.staleThreshold,
    probeTolerance: c.probeTolerance,
  };
  return {
    preset: "quality",
    quantizer: c.quantizer,
    quality: c.quantizer === "neuquant" ? c.neuquantQuality : undefined,
    imagequantQuality: c.imagequantQuality,
    imagequantSpeed: c.imagequantSpeed,
    maxColors: c.maxColors,
    palette: c.palette,
    dither: c.dither ? "floyd-steinberg" : false,
    temporalDither: c.temporalDither,
    temporalWeight: c.temporalDither ? c.temporalWeight : 0,
    lossyLzw: c.lossyLzw,
    optimize,
  };
}

function configKey(c: SweepConfig): string {
  return `${c.quantizer}_${c.palette}_mc${c.maxColors}_` +
    `q${c.imagequantQuality}_s${c.imagequantSpeed}_` +
    `nq${c.neuquantQuality}_lzw${c.lossyLzw}_` +
    `ht${c.holeTolerance}_d${c.dither ? "fs" : "no"}_` +
    `td${c.temporalDither ? "y" : "n"}_` +
    `pt${c.probeTolerance}_st${c.staleThreshold}`;
}

function configLabel(c: SweepConfig): string {
  const parts = [`${c.quantizer}`];
  if (c.quantizer === "imagequant") {
    parts.push(`q${c.imagequantQuality}`, `s${c.imagequantSpeed}`);
  } else {
    parts.push(`nq${c.neuquantQuality}`);
  }
  parts.push(c.palette, `mc${c.maxColors}`, `lzw${c.lossyLzw}`);
  if (c.holeTolerance) parts.push(`ht${c.holeTolerance}`);
  if (!c.dither) parts.push("nodither");
  if (c.temporalDither) parts.push("temporal");
  if (c.probeTolerance !== 3) parts.push(`pt${c.probeTolerance}`);
  if (c.staleThreshold !== 3) parts.push(`st${c.staleThreshold}`);
  return parts.join(" ");
}

function score(r: SweepResult): number {
  if (r.vmafMean === null) return -Infinity;
  return r.vmafMean - Math.max(0, (r.fileSize - 4400000) / 44000);
}

// ── Config generation ───────────────────────────────────────────

function generateStage1Configs(): SweepConfig[] {
  const configs: SweepConfig[] = [];

  const quantizers: Array<"imagequant" | "neuquant"> = ["imagequant", "neuquant"];
  const palettes: Array<"local" | "global" | "crossframe"> = ["local", "global", "crossframe"];
  const maxColorsValues = [64, 128, 192, 256];
  const iqQualityValues = [40, 60, 80, 100];
  const iqSpeedValues = [1, 4, 10];
  const nqQualityValues = [1, 10, 20, 30];
  const lossyLzwValues = [0, 4, 8, 15];
  const holeToleranceValues = [0, 3, 5];
  const ditherValues: Array<"floyd-steinberg" | false> = ["floyd-steinberg", false];
  const tolerancePairs: Array<[number, number]> = [[2, 2], [3, 3], [5, 5]];

  for (const quantizer of quantizers) {
    for (const palette of palettes) {
      for (const maxColors of maxColorsValues) {
        for (const lossyLzw of lossyLzwValues) {
          for (const holeTolerance of holeToleranceValues) {
            for (const dither of ditherValues) {
              // Pruning: dither=none + temporal makes no sense
              const temporalOptions = dither ? [false, true] : [false];
              // Pruning: palette=global + temporal makes less sense
              const filteredTemporal = palette === "global"
                ? [false] : temporalOptions;

              for (const temporalDither of filteredTemporal) {
                // Covary probe/stale tolerances; dither=none → only default pair
                const tPairs = dither ? tolerancePairs : [tolerancePairs[1]];

                for (const [probeTolerance, staleThreshold] of tPairs) {

                    if (quantizer === "imagequant") {
                      for (const iqQuality of iqQualityValues) {
                        for (const iqSpeed of iqSpeedValues) {
                          configs.push({
                            quantizer, palette, maxColors,
                            imagequantQuality: iqQuality,
                            imagequantSpeed: iqSpeed,
                            neuquantQuality: 10,
                            lossyLzw, holeTolerance,
                            dither, temporalDither,
                            temporalWeight: 0.25,
                            probeTolerance, staleThreshold,
                          });
                        }
                      }
                    } else {
                      for (const nqQuality of nqQualityValues) {
                        configs.push({
                          quantizer, palette, maxColors,
                          imagequantQuality: 80,
                          imagequantSpeed: 4,
                          neuquantQuality: nqQuality,
                          lossyLzw, holeTolerance,
                          dither, temporalDither,
                          temporalWeight: 0.25,
                          probeTolerance, staleThreshold,
                        });
                      }
                    }
                }
              }
            }
          }
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return configs.filter((c) => {
    const k = configKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function generateStage2Configs(winners: SweepConfig[]): SweepConfig[] {
  const configs: SweepConfig[] = [];
  const seen = new Set<string>();

  for (const w of winners) {
    const mcSteps = [w.maxColors - 32, w.maxColors - 16, w.maxColors, w.maxColors + 16, w.maxColors + 32]
      .filter((v) => v >= 16 && v <= 256);
    const qSteps = w.quantizer === "imagequant"
      ? [w.imagequantQuality - 10, w.imagequantQuality - 5, w.imagequantQuality, w.imagequantQuality + 5, w.imagequantQuality + 10]
          .filter((v) => v >= 20 && v <= 100)
      : [w.neuquantQuality];
    const sSteps = w.quantizer === "imagequant"
      ? [Math.max(1, w.imagequantSpeed - 1), w.imagequantSpeed, Math.min(10, w.imagequantSpeed + 1)]
      : [w.imagequantSpeed];
    const lzwSteps = [Math.max(0, w.lossyLzw - 1), w.lossyLzw, w.lossyLzw + 1, w.lossyLzw + 2]
      .filter((v) => v >= 0 && v <= 20);
    const htSteps = [Math.max(0, w.holeTolerance - 1), w.holeTolerance, w.holeTolerance + 1]
      .filter((v) => v >= 0 && v <= 10);
    const ptSteps = [Math.max(1, w.probeTolerance - 1), w.probeTolerance, w.probeTolerance + 1]
      .filter((v) => v >= 1 && v <= 10);
    const stSteps = [Math.max(1, w.staleThreshold - 1), w.staleThreshold, w.staleThreshold + 1]
      .filter((v) => v >= 1 && v <= 10);

    for (const mc of mcSteps) {
      for (const q of qSteps) {
        for (const s of sSteps) {
          for (const lzw of lzwSteps) {
            for (const ht of htSteps) {
              for (const pt of ptSteps) {
                for (const st of stSteps) {
                  const c: SweepConfig = {
                    ...w,
                    maxColors: mc,
                    imagequantQuality: w.quantizer === "imagequant" ? q : 80,
                    imagequantSpeed: w.quantizer === "imagequant" ? s : 4,
                    lossyLzw: lzw,
                    holeTolerance: ht,
                    probeTolerance: pt,
                    staleThreshold: st,
                  };
                  const k = configKey(c);
                  if (!seen.has(k)) {
                    seen.add(k);
                    configs.push(c);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return configs;
}

// ── Batch execution ─────────────────────────────────────────────

async function runBatch(
  configs: SweepConfig[],
  fixtureName: string,
  frames: Array<{ data: Uint8ClampedArray; delay: number }>,
  width: number,
  height: number,
  label: string,
): Promise<SweepResult[]> {
  const sourceDir = join(FIXTURES_DIR, fixtureName);
  const results: SweepResult[] = [];
  const batchSize = CONCURRENCY;
  const startTime = performance.now();

  let bestSoFar = { size: Infinity, vmaf: 0 };

  for (let batchStart = 0; batchStart < configs.length; batchStart += batchSize) {
    const batch = configs.slice(batchStart, batchStart + batchSize);

    // 1. Encode batch in parallel
    const jobs: EncodeJob[] = batch.map((c) => ({
      frames: frames.map((f) => ({ data: f.data, delay: f.delay })),
      width, height,
      options: configToOptions(c),
    }));
    const gifs = await encodeParallel(jobs, batchSize);

    // 2. Save all GIFs
    const gifPaths: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const p = join(TEMP_DIR, `sweep-${batchStart + j}.gif`);
      writeFileSync(p, gifs[j]);
      gifPaths.push(p);
    }

    // 3. Measure VMAF in parallel (8 concurrent ffmpeg processes)
    const vmafs = computeVmafBatch(sourceDir, gifPaths, width, height, 8);

    // 4. Collect results and clean up
    for (let j = 0; j < batch.length; j++) {
      const vmafMean = vmafs[j];
      const fileSize = gifs[j].length;
      try { rmSync(gifPaths[j]); } catch {}

      if (vmafMean !== null && fileSize < bestSoFar.size && vmafMean >= 94) {
        bestSoFar = { size: fileSize, vmaf: vmafMean };
      }
      results.push({ config: batch[j], fileSize, vmafMean, encodingTimeMs: 0 });
    }

    const done = Math.min(batchStart + batchSize, configs.length);
    const elapsed = (performance.now() - startTime) / 1000;
    const rate = done / elapsed;
    const remaining = (configs.length - done) / rate;
    const pct = ((done / configs.length) * 100).toFixed(1);
    const best = bestSoFar.size < Infinity
      ? `best: ${formatSize(bestSoFar.size)}/${bestSoFar.vmaf.toFixed(1)}`
      : "no qualifying result yet";
    const eta = remaining > 3600
      ? `${(remaining / 3600).toFixed(1)}h`
      : `${Math.round(remaining / 60)}m`;
    console.log(`  [${label}] ${done}/${configs.length} (${pct}%) | ${best} | ETA: ${eta}`);
  }

  return results;
}

// ── Analysis ────────────────────────────────────────────────────

function paretoFrontier(results: SweepResult[]): SweepResult[] {
  const valid = results.filter((r) => r.vmafMean !== null);
  valid.sort((a, b) => a.fileSize - b.fileSize);
  const pareto: SweepResult[] = [];
  let bestVmaf = -Infinity;
  for (const r of valid) {
    if (r.vmafMean! > bestVmaf) {
      pareto.push(r);
      bestVmaf = r.vmafMean!;
    }
  }
  return pareto;
}

function correlationTable(
  results: SweepResult[],
  paramName: string,
  extractor: (c: SweepConfig) => string | number,
  metric: "fileSize" | "vmafMean",
): string {
  const buckets = new Map<string, number[]>();
  for (const r of results) {
    if (metric === "vmafMean" && r.vmafMean === null) continue;
    const key = String(extractor(r.config));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(metric === "fileSize" ? r.fileSize : r.vmafMean!);
  }
  const entries = [...buckets.entries()].sort((a, b) => {
    const na = Number(a[0]), nb = Number(b[0]);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a[0].localeCompare(b[0]);
  });
  const parts = entries.map(([k, vals]) => {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return metric === "fileSize" ? `${k}=${formatSize(mean)}` : `${k}=${mean.toFixed(1)}`;
  });
  return `  ${paramName.padEnd(20)} ${parts.join("  ")}`;
}

// ── Report generation ───────────────────────────────────────────

function generateReport(
  stage1: SweepResult[],
  stage2: SweepResult[],
  stage3: Map<string, SweepResult[]>,
  stage3Configs: SweepConfig[],
): string {
  const md: string[] = ["# Exhaustive Parameter Sweep Report\n"];

  // Executive summary
  const allResults = [...stage1, ...stage2];
  const pareto = paretoFrontier(allResults);
  const target = allResults
    .filter((r) => r.vmafMean !== null && r.vmafMean >= 94.1 && r.fileSize <= 4400000)
    .sort((a, b) => a.fileSize - b.fileSize);

  md.push("## Executive Summary\n");
  if (target.length > 0) {
    const best = target[0];
    md.push(`**Target achieved**: ${formatSize(best.fileSize)} / VMAF ${best.vmafMean!.toFixed(2)}`);
    md.push(`Config: ${configLabel(best.config)}\n`);
  } else {
    md.push("**Target not achieved**: No config found with size ≤ 4.4MB AND VMAF ≥ 94.1\n");
    const closest = allResults
      .filter((r) => r.vmafMean !== null)
      .sort((a, b) => score(b) - score(a));
    if (closest.length > 0) {
      const c = closest[0];
      md.push(`Closest: ${formatSize(c.fileSize)} / VMAF ${c.vmafMean!.toFixed(2)}`);
      md.push(`Config: ${configLabel(c.config)}\n`);
    }
  }

  // Stage 1 correlations
  md.push("## Stage 1: Parameter Correlations\n");
  md.push("### Size Impact (mean file size per parameter value)\n```");
  const params: Array<[string, (c: SweepConfig) => string | number]> = [
    ["quantizer", (c) => c.quantizer],
    ["palette", (c) => c.palette],
    ["maxColors", (c) => c.maxColors],
    ["lossyLzw", (c) => c.lossyLzw],
    ["holeTolerance", (c) => c.holeTolerance],
    ["dither", (c) => c.dither || "none"],
    ["probeTolerance", (c) => c.probeTolerance],
    ["staleThreshold", (c) => c.staleThreshold],
  ];
  for (const [name, fn] of params) {
    md.push(correlationTable(stage1, name, fn, "fileSize"));
  }
  md.push("```\n");

  md.push("### VMAF Impact (mean VMAF per parameter value)\n```");
  for (const [name, fn] of params) {
    md.push(correlationTable(stage1, name, fn, "vmafMean"));
  }
  md.push("```\n");

  // Pareto frontier
  md.push("## Pareto Frontier\n");
  md.push("| Size | VMAF | Config |");
  md.push("|------|------|--------|");
  for (const r of pareto.slice(0, 30)) {
    md.push(`| ${formatSize(r.fileSize)} | ${r.vmafMean!.toFixed(2)} | ${configLabel(r.config)} |`);
  }
  md.push("");

  // Top 20 from stage 2
  if (stage2.length > 0) {
    md.push("## Stage 2: Refined Top 20\n");
    const sorted = [...stage2].filter((r) => r.vmafMean !== null).sort((a, b) => score(b) - score(a));
    md.push("| Rank | Size | VMAF | Score | Config |");
    md.push("|------|------|------|-------|--------|");
    for (let i = 0; i < Math.min(20, sorted.length); i++) {
      const r = sorted[i];
      md.push(`| ${i + 1} | ${formatSize(r.fileSize)} | ${r.vmafMean!.toFixed(2)} | ${score(r).toFixed(1)} | ${configLabel(r.config)} |`);
    }
    md.push("");
  }

  // Cross-fixture validation
  if (stage3.size > 0) {
    md.push("## Stage 3: Cross-Fixture Validation\n");
    for (let ci = 0; ci < Math.min(5, stage3Configs.length); ci++) {
      const c = stage3Configs[ci];
      const label = configLabel(c);
      md.push(`### Config #${ci + 1}: ${label}\n`);
      md.push("| Fixture | Size | VMAF | gifski Size | gifski VMAF | Δ Size | Δ VMAF |");
      md.push("|---------|------|------|-------------|-------------|--------|--------|");

      const fixtures = stage3.get(configKey(c));
      if (fixtures) {
        for (const r of fixtures) {
          const gkPath = join(REFS_DIR, `${(r as any).fixture}-gifski.gif`);
          let gkSize = 0, gkVmaf = "-";
          if (existsSync(gkPath)) {
            gkSize = statSync(gkPath).size;
            // gifski VMAF would need to be computed; skip for report
            gkVmaf = "-";
          }
          const fixture = (r as any).fixture || "?";
          const deltaSize = gkSize > 0 ? `${((r.fileSize - gkSize) / gkSize * 100).toFixed(0)}%` : "-";
          md.push(`| ${fixture} | ${formatSize(r.fileSize)} | ${r.vmafMean?.toFixed(2) ?? "N/A"} | ${formatSize(gkSize)} | ${gkVmaf} | ${deltaSize} | - |`);
        }
      }
      md.push("");
    }
  }

  return md.join("\n");
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  mkdirSync(TEMP_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  // ── Generate Stage 1 configs ──
  const stage1Configs = generateStage1Configs();
  console.log(`Stage 1: ${stage1Configs.length} configurations\n`);

  if (DRY_RUN) {
    console.log("First 10 configs:");
    for (const c of stage1Configs.slice(0, 10)) {
      console.log(`  ${configLabel(c)}`);
    }
    console.log(`  ... and ${stage1Configs.length - 10} more`);
    console.log("\nLast 5 configs:");
    for (const c of stage1Configs.slice(-5)) {
      console.log(`  ${configLabel(c)}`);
    }
    return;
  }

  // ── Load big-buck-bunny ──
  const bbbDir = join(FIXTURES_DIR, "big-buck-bunny");
  if (!existsSync(bbbDir)) {
    console.error("big-buck-bunny fixture not found. Run: npm run fixtures");
    process.exit(1);
  }
  const bbb = loadPngFrames(bbbDir);
  console.log(`big-buck-bunny: ${bbb.width}×${bbb.height}, ${bbb.frames.length} frames\n`);

  // ── Validation batch: 3 configs ──
  const validationIndices = [
    0,
    Math.floor(stage1Configs.length / 2),
    stage1Configs.length - 1,
  ];
  const validationConfigs = validationIndices.map((i) => stage1Configs[i]);

  console.log("Validation batch (3 configs)...");
  const valStart = performance.now();
  const valResults = await runBatch(
    validationConfigs, "big-buck-bunny",
    bbb.frames, bbb.width, bbb.height, "validation",
  );
  const valTime = (performance.now() - valStart) / 1000;

  console.log("\nValidation results:");
  for (let i = 0; i < valResults.length; i++) {
    const r = valResults[i];
    console.log(`  ${configLabel(r.config)}`);
    console.log(`    Size: ${formatSize(r.fileSize)}, VMAF: ${r.vmafMean?.toFixed(2) ?? "N/A"}`);
  }

  const perConfig = valTime / 3;
  const estTotal = (stage1Configs.length / CONCURRENCY) * perConfig;
  console.log(`\nPer-config time: ${perConfig.toFixed(1)}s`);
  console.log(`Estimated Stage 1 time: ${(estTotal / 3600).toFixed(1)} hours`);
  console.log(`Estimated total (all stages): ${(estTotal * 1.3 / 3600).toFixed(1)} hours\n`);

  // ── Parallel validation: 16 simultaneous ──
  console.log("Parallel validation (16 simultaneous)...");
  const par16 = stage1Configs.slice(0, 16);
  const par16Start = performance.now();
  await runBatch(
    par16, "big-buck-bunny",
    bbb.frames, bbb.width, bbb.height, "parallel-check",
  );
  const par16Time = (performance.now() - par16Start) / 1000;
  console.log(`  16 configs in ${par16Time.toFixed(1)}s — no crashes.\n`);

  // Refined estimate
  const perBatch16 = par16Time / 16;
  const estStage1 = (stage1Configs.length / CONCURRENCY) * (par16Time / 1);
  console.log(`Refined estimate: ${(estStage1 / 3600).toFixed(1)} hours for Stage 1\n`);

  // ── Stage 1: Full grid ──
  console.log(`\n=== Stage 1: Full grid (${stage1Configs.length} configs) ===\n`);
  const s1Start = performance.now();
  const stage1Results = await runBatch(
    stage1Configs, "big-buck-bunny",
    bbb.frames, bbb.width, bbb.height, "S1",
  );
  const s1Time = (performance.now() - s1Start) / 1000;
  console.log(`\nStage 1 complete: ${(s1Time / 3600).toFixed(2)} hours\n`);

  // Save Stage 1 results
  const s1Path = join(RESULTS_DIR, "sweep-bbb-full.json");
  writeFileSync(s1Path, JSON.stringify(stage1Results, null, 2));
  console.log(`Stage 1 saved to ${s1Path}`);

  // Print top 50 by score
  const sorted1 = [...stage1Results]
    .filter((r) => r.vmafMean !== null)
    .sort((a, b) => score(b) - score(a));
  console.log("\nTop 50 by score:");
  console.log("  Rank | Size     | VMAF  | Score | Config");
  console.log("  -----|----------|-------|-------|-------");
  for (let i = 0; i < Math.min(50, sorted1.length); i++) {
    const r = sorted1[i];
    console.log(`  ${String(i + 1).padStart(4)} | ${formatSize(r.fileSize).padStart(8)} | ${r.vmafMean!.toFixed(1).padStart(5)} | ${score(r).toFixed(1).padStart(5)} | ${configLabel(r.config)}`);
  }

  // Correlation analysis
  console.log("\n=== SIZE impact (mean file size per parameter value) ===");
  const paramExtractors: Array<[string, (c: SweepConfig) => string | number]> = [
    ["palette", (c) => c.palette],
    ["maxColors", (c) => c.maxColors],
    ["quantizer", (c) => c.quantizer],
    ["dither", (c) => c.dither || "none"],
    ["lossyLzw", (c) => c.lossyLzw],
    ["holeTolerance", (c) => c.holeTolerance],
    ["probeTolerance", (c) => c.probeTolerance],
    ["staleThreshold", (c) => c.staleThreshold],
  ];
  for (const [name, fn] of paramExtractors) {
    console.log(correlationTable(stage1Results, name, fn, "fileSize"));
  }

  console.log("\n=== VMAF impact (mean VMAF per parameter value) ===");
  for (const [name, fn] of paramExtractors) {
    console.log(correlationTable(stage1Results, name, fn, "vmafMean"));
  }

  // Pareto frontier
  const pareto = paretoFrontier(stage1Results);
  console.log("\nPareto frontier (size vs VMAF):");
  for (const r of pareto) {
    console.log(`  ${formatSize(r.fileSize)} / ${r.vmafMean!.toFixed(1)} VMAF | ${configLabel(r.config)}`);
  }

  // ── Stage 2: Refinement ──
  const paretoTop10 = pareto
    .filter((r) => r.vmafMean! >= 93)
    .slice(0, 10);
  const stage2Configs = generateStage2Configs(paretoTop10.map((r) => r.config));
  console.log(`\n=== Stage 2: Refinement (${stage2Configs.length} configs) ===\n`);

  const s2Start = performance.now();
  const stage2Results = await runBatch(
    stage2Configs, "big-buck-bunny",
    bbb.frames, bbb.width, bbb.height, "S2",
  );
  const s2Time = (performance.now() - s2Start) / 1000;
  console.log(`\nStage 2 complete: ${(s2Time / 60).toFixed(1)} minutes\n`);

  const s2Path = join(RESULTS_DIR, "sweep-bbb-refined.json");
  writeFileSync(s2Path, JSON.stringify(stage2Results, null, 2));

  // Top 20 refined
  const sorted2 = [...stage2Results]
    .filter((r) => r.vmafMean !== null)
    .sort((a, b) => score(b) - score(a));
  console.log("Top 20 refined:");
  for (let i = 0; i < Math.min(20, sorted2.length); i++) {
    const r = sorted2[i];
    console.log(`  ${i + 1}. ${formatSize(r.fileSize)} / ${r.vmafMean!.toFixed(2)} | ${configLabel(r.config)}`);
  }

  // ── Stage 3: Cross-fixture validation ──
  const top20Configs = sorted2.slice(0, 20).map((r) => r.config);
  const allFixtures = readdirSync(FIXTURES_DIR)
    .filter((name) => {
      const dir = join(FIXTURES_DIR, name);
      return statSync(dir).isDirectory() &&
        readdirSync(dir).filter((f) => f.endsWith(".png")).length >= 2;
    })
    .sort();

  console.log(`\n=== Stage 3: Cross-fixture (${top20Configs.length} configs × ${allFixtures.length} fixtures) ===\n`);

  const stage3Map = new Map<string, (SweepResult & { fixture: string })[]>();

  for (const fixtureName of allFixtures) {
    const fixtureDir = join(FIXTURES_DIR, fixtureName);
    const fixture = loadPngFrames(fixtureDir);

    for (const c of top20Configs) {
      const jobs: EncodeJob[] = [{
        frames: fixture.frames.map((f) => ({ data: f.data, delay: f.delay })),
        width: fixture.width,
        height: fixture.height,
        options: configToOptions(c),
      }];

      const gifs = await encodeParallel(jobs, 1);
      const gif = gifs[0];
      const gifPath = join(TEMP_DIR, `s3-${fixtureName}-${configKey(c)}.gif`);
      writeFileSync(gifPath, gif);
      const vmaf = computeVmaf(fixtureDir, gifPath, fixture.width, fixture.height);
      try { rmSync(gifPath); } catch {}

      const key = configKey(c);
      if (!stage3Map.has(key)) stage3Map.set(key, []);
      stage3Map.get(key)!.push({
        config: c,
        fileSize: gif.length,
        vmafMean: vmaf,
        encodingTimeMs: 0,
        fixture: fixtureName,
      });
    }

    console.log(`  ${fixtureName}: done`);
  }

  // ── Stage 4: Report ──
  console.log("\n=== Stage 4: Report ===\n");
  const report = generateReport(stage1Results, stage2Results, stage3Map as any, top20Configs);
  const reportPath = join(__dirname, "sweep-bbb-report.md");
  writeFileSync(reportPath, report);
  console.log(`Report saved to ${reportPath}`);

  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}

  console.log("\nEverything validated. Run this command to start the sweep:");
  console.log("");
  console.log("  npx tsx test/bench/sweep-exhaustive.ts 2>&1 | tee test/bench/sweep-log.txt");
  console.log("");
  console.log("Monitor progress in another terminal: tail -f test/bench/sweep-log.txt");
  console.log("Results will be saved to:");
  console.log("  test/bench/results/sweep-bbb-full.json (Stage 1 raw data)");
  console.log("  test/bench/results/sweep-bbb-refined.json (Stage 2 refined)");
  console.log("  test/bench/sweep-bbb-report.md (final report)");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
