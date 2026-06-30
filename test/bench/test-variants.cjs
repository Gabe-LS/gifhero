/**
 * Variant test runner — encodes fixtures with patched dist files,
 * computes VMAF + DSSIM in parallel, outputs JSON for the viewer.
 *
 * Usage:
 *   node test/bench/test-variants.cjs <config.cjs>
 *
 * Config exports: { fixtures, variants, workers?, outputName? }
 *   fixtures: string[] — fixture names
 *   variants: { label, patch?(src)=>src, opts? }[] — encode variants
 *   workers: number — parallel metric jobs (default 6)
 *   outputName: string — output filename (default 'variant-test')
 */

const { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } = require('fs');
const { join, basename, resolve } = require('path');
const { execSync } = require('child_process');
const { createCanvas, Image } = require('canvas');

const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'generated');
const GIFS_DIR = join(__dirname, 'results', 'gifs');
const LOGS_DIR = join(__dirname, 'results', 'logs');
const RESULTS_DIR = join(__dirname, 'results');
const ORIGINAL_DIST = join(__dirname, '..', '..', 'dist', 'index-original.cjs');

mkdirSync(LOGS_DIR, { recursive: true });

// --- Frame loading (cached per fixture) ---

const frameCache = {};
function loadFrames(fixture) {
  if (frameCache[fixture]) return frameCache[fixture];
  const dir = join(FIXTURES_DIR, fixture);
  const files = readdirSync(dir).filter(f => f.endsWith('.png')).sort();
  const frames = [];
  let width = 0, height = 0;
  for (const file of files) {
    const img = new Image();
    img.src = readFileSync(join(dir, file));
    if (!width) { width = img.width; height = img.height; }
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    frames.push({ data: ctx.getImageData(0, 0, img.width, img.height).data, width, height, delay: 50 });
  }
  frameCache[fixture] = { frames, width, height };
  return { frames, width, height };
}

// --- Metrics ---

function computeVmaf(sourceDir, gifPath, w, h) {
  const logPath = join(LOGS_DIR, `${basename(gifPath, '.gif')}-vmaf.json`);
  try {
    execSync(
      `ffmpeg -y -framerate 20 -i "${sourceDir}/%04d.png" -r 20 -i "${gifPath}" ` +
      `-filter_complex "[1:v]scale=${w}:${h}:flags=bicubic[dist];` +
      `[0:v][dist]libvmaf=log_path=${logPath}:log_fmt=json:feature=name=ciede" -f null - 2>&1`,
      { encoding: 'utf-8', timeout: 300000 }
    );
    const data = JSON.parse(readFileSync(logPath, 'utf-8'));
    return {
      vmafMean: data.pooled_metrics?.vmaf?.mean ?? null,
      vmafMin: data.pooled_metrics?.vmaf?.min ?? null,
      ciede2000: data.pooled_metrics?.ciede2000?.mean ?? null,
    };
  } catch { return { vmafMean: null, vmafMin: null, ciede2000: null }; }
}

function computeDssim(sourceDir, gifPath) {
  const extractDir = join(LOGS_DIR, basename(gifPath, '.gif') + '-frames');
  mkdirSync(extractDir, { recursive: true });
  try { execSync(`ffmpeg -y -i "${gifPath}" -vsync 0 "${extractDir}/%04d.png"`, { stdio: 'ignore', timeout: 60000 }); }
  catch { return { dssimMean: null }; }
  const srcFiles = readdirSync(sourceDir).filter(f => f.endsWith('.png')).sort();
  const encFiles = readdirSync(extractDir).filter(f => f.endsWith('.png')).sort();
  const count = Math.min(srcFiles.length, encFiles.length);
  const values = [];
  for (let i = 0; i < count; i++) {
    try {
      const out = execSync(`dssim "${sourceDir}/${srcFiles[i]}" "${extractDir}/${encFiles[i]}"`, { encoding: 'utf-8', timeout: 10000 });
      values.push(parseFloat(out.trim().split('\t')[0]));
    } catch { break; }
  }
  try { execSync(`rm -rf "${extractDir}"`, { stdio: 'ignore' }); } catch {}
  if (!values.length) return { dssimMean: null };
  values.sort((a, b) => a - b);
  return {
    dssimMean: values.reduce((s, v) => s + v, 0) / values.length,
    dssimMax: values[values.length - 1],
    dssimP95: values[Math.floor(values.length * 0.95)],
  };
}

const hasDssim = (() => { try { execSync('command -v dssim', { stdio: 'ignore' }); return true; } catch { return false; } })();

// --- Dist patching ---

function buildDist(variant) {
  if (!variant.patch) return ORIGINAL_DIST;
  const src = readFileSync(ORIGINAL_DIST, 'utf-8');
  const patched = variant.patch(src);
  const outPath = join(__dirname, '..', '..', 'dist', `index-variant-${variant.label}.cjs`);
  writeFileSync(outPath, patched);
  return outPath;
}

// --- Main ---

async function run(config) {
  const { fixtures, variants, workers = 6, outputName = 'variant-test' } = config;

  console.log(`Fixtures: ${fixtures.join(', ')}`);
  console.log(`Variants: ${variants.map(v => v.label).join(', ')}`);
  console.log(`Workers: ${workers}, DSSIM: ${hasDssim}\n`);

  // Build patched dists
  const distPaths = {};
  for (const v of variants) {
    distPaths[v.label] = buildDist(v);
  }

  // Phase 1: Encode
  const jobs = [];
  for (const fixture of fixtures) {
    const sourceDir = join(FIXTURES_DIR, fixture);
    let loaded;
    try { loaded = loadFrames(fixture); } catch { console.log(`${fixture}: SKIP`); continue; }
    const { frames, width, height } = loaded;
    console.log(`${fixture}: ${frames.length} frames, ${width}x${height}`);

    for (const v of variants) {
      const distPath = distPaths[v.label];
      delete require.cache[require.resolve(distPath)];
      const { encode } = require(distPath);
      const encoderName = `test-${v.label}`;
      const gifPath = join(GIFS_DIR, `${fixture}-${encoderName}.gif`);
      const defaults = { width, height, frames, preset: 'balanced', palette: 'local' };
      const opts = { ...defaults, ...(v.opts || {}) };

      try {
        const t0 = Date.now();
        const result = await encode(opts);
        const ms = Date.now() - t0;
        writeFileSync(gifPath, Buffer.from(result));
        const kb = (result.byteLength / 1024).toFixed(0);
        console.log(`  ${v.label}: ${kb} KB (${ms}ms)`);
        jobs.push({ fixture, encoderName, gifPath, sourceDir, width, height, label: v.label, fileSize: result.byteLength, encodingTimeMs: ms });
      } catch (e) {
        console.log(`  ${v.label}: FAILED — ${e.message}`);
      }
    }
  }

  // Phase 2: Metrics in parallel batches
  console.log(`\nMetrics: ${jobs.length} files in batches of ${workers}...`);
  const allResults = [];

  for (let i = 0; i < jobs.length; i += workers) {
    const batch = jobs.slice(i, i + workers);
    const batchNum = Math.floor(i / workers) + 1;
    const totalBatches = Math.ceil(jobs.length / workers);

    const promises = batch.map(job => new Promise(resolve => {
      const vmaf = computeVmaf(job.sourceDir, job.gifPath, job.width, job.height);
      let dssim = { dssimMean: null };
      if (hasDssim) dssim = computeDssim(job.sourceDir, job.gifPath);

      resolve({
        encoder: job.encoderName,
        fixture: job.fixture,
        fileSize: job.fileSize,
        frameCount: 100,
        encodingTimeMs: job.encodingTimeMs,
        vmafMean: vmaf.vmafMean,
        vmafMin: vmaf.vmafMin,
        ciede2000: vmaf.ciede2000,
        dssimMean: dssim.dssimMean ?? null,
        dssimMax: dssim.dssimMax ?? null,
        dssimP95: dssim.dssimP95 ?? null,
        ssimMean: null,
        psnrMean: null,
        cambiBanding: null,
        flickerScore: null,
        vmafPerMB: vmaf.vmafMean ? vmaf.vmafMean / (job.fileSize / (1024 * 1024)) : null,
      });
    }));

    const results = await Promise.all(promises);
    for (const r of results) {
      console.log(`  [${batchNum}/${totalBatches}] ${r.fixture}/${r.encoder.replace('test-','')}: VMAF=${r.vmafMean?.toFixed(1) ?? 'n/a'} DSSIM=${r.dssimMean?.toFixed(5) ?? 'n/a'} Size=${(r.fileSize/1024).toFixed(0)}KB`);
      allResults.push(r);
    }
  }

  // Phase 3: Summary table
  console.log('\n=== Summary ===\n');
  for (const fixture of fixtures) {
    const rows = allResults.filter(r => r.fixture === fixture);
    if (!rows.length) continue;
    const base = rows[0];
    console.log(`${fixture}:`);
    for (const r of rows) {
      const name = r.encoder.replace('test-', '').padEnd(24);
      const sz = (r.fileSize / 1024).toFixed(0).padStart(6);
      const vm = (r.vmafMean?.toFixed(1) ?? 'n/a').padStart(5);
      const ds = (r.dssimMean?.toFixed(5) ?? 'n/a').padStart(9);
      const szD = ((r.fileSize - base.fileSize) / base.fileSize * 100).toFixed(0).padStart(5);
      const vmD = r.vmafMean && base.vmafMean ? (r.vmafMean - base.vmafMean).toFixed(1).padStart(5) : '  n/a';
      console.log(`  ${name} ${sz}KB  VMAF${vm} (${vmD})  DSSIM${ds}  size${szD}%`);
    }
    console.log('');
  }

  // Phase 4: Save
  const outPath = join(RESULTS_DIR, `${outputName}.json`);
  const report = { timestamp: new Date().toISOString(), results: allResults };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Saved: ${outPath}`);
  console.log(`Viewer: http://127.0.0.1:8770/viewer.html?results=results/${outputName}.json`);
}

// Load config
const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node test/bench/test-variants.cjs <config.cjs>');
  process.exit(1);
}
const config = require(resolve(configPath));
run(config).catch(e => { console.error(e); process.exit(1); });
