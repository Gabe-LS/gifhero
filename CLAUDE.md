# gifhero

## What This Is
A GIF encoding library with a TypeScript browser SDK and a native Rust CLI.
Produces 4-15% smaller files than gifski at equal or better VMAF across 25 fixtures × 4 resolutions.

## Tech Stack
- **Browser SDK**: TypeScript (strict mode), ES2020, tsup (ESM + CJS)
- **Native CLI**: Rust, Rayon multi-threading, imagequant with internal threading
- Custom libimagequant WASM with `set_background` / `set_importance_map` for native GIF transparency
- WASM embedded as base64 — works in Node.js, browsers, workers, Chrome extensions (no fs/fetch needed)
- WASM Lanczos3 downscaling (12× faster than pure JS)
- Zero Node-only APIs in the ESM bundle — no runtime dependencies
- Browser bundle: ~985KB ESM (self-contained, WASM included)
- CLI binary: 960KB (statically linked)

## Native CLI (`packages/gifhero-core`)

Rust crate with the full encoding pipeline. Compiles to native binary and WASM.

### Usage
```bash
# Single file
gifhero input.mp4 -w 480 --fps 20 -o output.gif

# Multiple files (parallel encoding)
gifhero video1.mp4 video2.mp4 video3.mp4 -w 480 -o outdir/

# Quality preset
gifhero input.mp4 -w 480 --preset quality -o output.gif
```

### Building
```bash
cd packages/gifhero-core
cargo build --release --features cli
```

### Performance
- Single file (100 frames, 480p): ~0.9s
- Batch throughput: 3.4 files/s at 4-wide concurrency (5.2× vs sequential)
- vs gifski CLI: 2.5× slower per file, but 7-14% smaller output

## Conventions
- Pure functions where possible. No classes unless managing stateful resources (workers, WASM instances).
- All pixel data as Uint8Array or Uint8ClampedArray.
- Every public function has JSDoc with @param and @returns.
- Error messages must be actionable ("Frame 3 has 0 pixels — did you pass an empty canvas?" not "Invalid input").
- Never mutate input data. Clone if needed.

## Architecture

The encoding pipeline is two-pass: **probe** then **encode**.

### Pass 1: Probe (`src/probe.ts`)

Scans all source frames to build a content profile before any encoding:

- **Static mask**: per-pixel flag — 1 if the pixel never changes across all frames (min/max range ≤ tolerance). Drives unconditional transparency.
- **Motion level**: average fraction of pixels changing per frame (threshold > 5 per channel).
- **Color complexity**: distinct 6-bit-quantized colors across sampled frames.
- **Keyframes**: scene changes (> 60% pixels change) AND motion-to-static transitions (> 15% motion followed by < 2%). Canvas is reset at keyframes to prevent error accumulation.

Probe runs in < 100ms for 60 frames at 480×270 (pure RGB arithmetic, no quantization).

### Downscaling (`src/resize.ts` + WASM)

Lanczos3 (sinc-windowed sinc) resampling with two implementations:
- **WASM** (default): `downsample_lanczos3()` in the Rust crate. Precomputed kernel weights, f32 accumulators. ~18ms/frame for 1080p→480p (12× faster than JS).
- **Pure JS** fallback: `downsample()` in `src/resize.ts`. ~228ms/frame. Exported for consumers who don't load the WASM module.

Both are two-pass separable filters with correct non-premultiplied alpha handling. Outputs are bit-identical.

### Pass 2: Encode

WASM Lanczos3 downscaling via `targetWidth`, then two quantizer paths selected automatically:

#### Background-aware path (default when WASM available)

Uses the custom `imagequant-gif` WASM module (`src/quantizers/imagequant-gif.ts`):

```
Source frames
  → Lanczos3 downscale (if targetWidth set)
  → Temporal denoise (balanced only, noise-aware gate)
  → Probe: static mask, motion × complexity, keyframes
  → Content-adaptive staleThreshold:
      balanced: min(8, max(2, round(4 + 4 × min(1, complexity/8000))))
      quality: min(10, max(2, round(4 + 6 × min(1, complexity/5000))))
      (complexity = motionLevel × colorComplexity)
  → Adaptive maxColors:
      quality: 224 when colorComplexity ≥ 30K
      balanced: 192 when colorComplexity ≥ 20K
  → Palette fitness model:
      Build shared palette via gifBuildPalette at keyframes
      Remap subsequent frames via gifRemapPalette (fast path)
      Rebuild when palette fitness degrades (mean nearest-color distance > 12)
      or after 30 frames, whichever comes first
  → Deferred LZW clear code (continue matching when dictionary full)
  → Power-of-2 palette targeting (evict entries to cross bit boundary)
  → Frame 0 / keyframes: build palette from nearby frames, remap
  → Frames 1+:
      1. Zero alpha on static-mask pixels
      2. Zero alpha on pixels where source ≈ canvas (≤ staleThreshold)
         with texture-aware threshold (smooth areas get lower threshold)
         and direction-aware forward-look
      3. Quantize or remap with background awareness
         → libimagequant natively produces transparent pixels
         → Dithering blends seamlessly with canvas via set_background
      4. Edge sparse suppression: suppress isolated near-stale pixels
         in outermost 40% of bbox to shrink crop rectangle
      5. Compute tight bbox of non-transparent pixels
      6. Crop indexed output to bbox
      7. Trim palette to used entries
      8. Composite opaque pixels onto canvas for next frame
  → LZW → GIF89a writer
```

#### Fallback path (neuquant or when WASM unavailable)

Uses the old imagequant npm package or NeuQuant with post-dither transparency:

```
Source frames
  → Lanczos3 downscale (if targetWidth set)
  → Probe: build static mask
  → Palette strategy from probe (global if colorComplexity < 1000)
  → Frame 0 / keyframes: quantize → decode to canvas
  → Frames 1+:
      1. Find bbox: skip static pixels, source-vs-canvas > staleThreshold
      2. Crop source to bbox
      3. Quantize crop (imagequant or neuquant + F-S dithering)
      4. buildSubframe: source-vs-canvas hole punching + palette eviction
      5. Trim palette, tight crop, composite onto canvas
  → Lossy LZW (optional)
  → GIF89a writer
```

### Custom WASM module (`packages/imagequant-gif-wasm`)

Rust crate wrapping libimagequant v4 with wasm-bindgen. Exposes:

- `quantize_with_background()` — the key API gifski uses. Passes the decoded canvas as background so dithering blends seamlessly at transparency boundaries.
- `quantize_simple()` — standard quantization for frame 0.
- `quantize_no_dither()` — nearest-color mapping without error diffusion.
- `set_importance_map()` — de-prioritizes static pixels in palette allocation.
- `build_shared_palette()` — pools sampled frames via Histogram for multi-frame shared palette.
- `remap_with_palette()` — remaps frame with pre-built palette + background awareness.
- `downsample_lanczos3()` — Lanczos3 downscale with precomputed kernel weights. 12× faster than pure JS (18ms vs 228ms for 1080p→480p). Bit-identical output.

Built with `wasm-pack --target nodejs --no-opt` (135KB WASM binary). The binary is embedded as base64 in `imagequant-gif-wasm.ts` for universal loading. The ESM glue replaces the wasm-pack CJS output to avoid Node-only APIs (`fs`, `createRequire`, `__dirname`).

### File structure

```
src/
├── index.ts                    Main encode() API, presets, two-pass pipeline
├── probe.ts                    Pre-encode frame analysis (static mask, motion, keyframes)
├── resize.ts                   Lanczos3 downscaling (pure JS fallback)
├── quantizers/
│   ├── neuquant.ts             NeuQuant neural network quantizer (256 colors)
│   ├── imagequant.ts           libimagequant WASM wrapper (npm package, fallback)
│   └── imagequant-gif.ts       Custom WASM wrapper with set_background support
├── wasm/
│   └── imagequant-gif/         Pre-built WASM binary + JS glue
├── dither/
│   ├── floyd-steinberg.ts      Floyd-Steinberg error diffusion + mapNearest
│   └── temporal.ts             Temporal dithering (disabled in presets)
├── optimize/
│   ├── subframe.ts             Probe-driven sub-frame: findChangedBbox, buildSubframe,
│   │                           compositeOntoCanvas, trimPalette, palette eviction
│   ├── frame-diff.ts           Legacy RGBA-based frame differencing
│   ├── disposal.ts             Disposal method optimization
│   ├── palette-strategy.ts     Palette strategies: local, global, crossframe, adaptive
│   ├── palette-sort.ts         Luminance-based palette sorting
│   └── stabilize.ts            Post-dither pixel stabilization (superseded)
├── encoder/
│   ├── gif-writer.ts           GIF89a binary writer (headers, LCT/GCT, GCE, sub-blocking)
│   ├── lzw.ts                  Standard LZW encoder
│   └── lossy-lzw.ts            Lossy LZW with Chebyshev distance matching
└── types/                      TypeScript declarations for WASM modules

packages/
├── imagequant-gif-wasm/        Rust crate for custom libimagequant WASM
│   ├── Cargo.toml
│   └── src/lib.rs
└── gifhero-core/               Rust crate — full encoding pipeline + CLI
    ├── Cargo.toml
    ├── src/
    │   ├── lib.rs              encode() + encode_parallel() orchestrators
    │   ├── probe.rs            Static mask, motion, color complexity, keyframes
    │   ├── denoise.rs          3-frame temporal median
    │   ├── quantize.rs         imagequant wrapper
    │   ├── subframe.rs         Bbox, crop, canvas, trim palette (power-of-2)
    │   ├── lanczos3.rs         Lanczos3 downscale (precomputed kernels)
    │   ├── lzw.rs              Standard + lossy LZW (deferred clear)
    │   ├── gif.rs              GIF89a binary writer
    │   ├── dither.rs           Floyd-Steinberg (fallback path)
    │   ├── wasm.rs             wasm-bindgen exports
    │   └── main.rs             CLI (clap + ffmpeg pipe + multi-file)
    └── examples/
        └── encode_test.rs      Benchmark utility

test/bench/
├── run.ts                      Benchmark runner (25 fixtures × 4 resolutions × 3 encoders)
├── parallel.ts                 Worker-thread parallel encoding (6× speedup)
├── encode-worker.ts            Worker script for parallel encoding
├── sensitivity.ts              Parameter sensitivity analysis
├── sweep-exhaustive.ts         Full parameter grid sweep
├── REPORT.md                   Full benchmark report vs gifski
└── references/                 Saved GIF outputs for visual comparison

reports/
├── compression-optimization-tests.md    Tests from lossyLzw≤5 investigation
├── compression-report-strategies-test.md Tests of external compression strategies
└── temporal-denoiser-investigation.md   Denoiser design, noise analysis, threshold tuning
```

## Presets

### quality
Maximum VMAF and minimal posterization. Best for visual fidelity.
- quantizer: imagequant (q98, speed 1)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4 (adaptive up to 5)
- staleThreshold: base 4, motionFloor 4/5
- maxColors: 256 (224 when colorComplexity ≥ 30K)
- No per-frame threshold boost

### balanced (default)
Maximum compression with reduced posterization. Best for file size.
- quantizer: imagequant (q90, speed 4)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4 (adaptive up to 5)
- staleThreshold: content-adaptive, min(8, max(2, round(4 + 4 × min(1, complexity/8000))))
- maxColors: 256 (192 when colorComplexity ≥ 20K)
- Noise-aware temporal denoiser (3-frame median, threshold 3)
- Palette fitness model: shared palette + remap, rebuild on drift

Both presets share: palette fitness model, keyframe detection, Lanczos3 downscaling, deferred LZW clear, power-of-2 palette targeting, edge sparse suppression.

## Encode Options

Key options beyond presets:
- `targetWidth`: Lanczos3 downscale to this width (height auto from aspect ratio)
- `targetHeight`: explicit target height (omit to auto-calculate)
- `imagequantQuality` (0-100): override imagequant quality
- `imagequantSpeed` (1-10): override imagequant speed
- `maxColors` (2-256): maximum palette size
- `palette` ('local' | 'global' | 'crossframe'): palette strategy
- `dither` ('floyd-steinberg' | false): dithering method
- `lossyLzw` (0-200): lossy LZW compression level
- `optimize.staleThreshold`: override the content-adaptive transparency threshold
- `optimize.probeTolerance`: probe static-mask sensitivity

## Commands
- `npm run build` — build with tsup
- `npm run test` — run vitest (52 tests)
- `npm run bench` — full benchmark (25 fixtures × 4 resolutions), sequential encoding + parallel metrics
- `npm run bench:fast` — fast benchmark (6 fixtures, gifhero + gifski only)
- `npm run bench:parallel` — parallel mode: all encoding + metrics concurrent, ~5× faster, no timing capture

### Benchmark tool (`test/bench/run.ts`)

Two modes:
- **Default**: encodes sequentially (accurate per-encoder timing), metrics 8-wide parallel
- **Parallel** (`--parallel`): gifhero via 8 worker threads, external encoders via 8 concurrent processes, metrics 8-wide — fastest for testing, no timing capture

Output structure: `test/bench/results/{timestamp}/results.json` + `gifs/`, with `latest` symlink.

Key CLI options:
```
--fixtures <names>      Comma-separated [default: all 25]
--resolutions <widths>  Comma-separated [default: 480,360,240,160]
--encoders <names>      Comma-separated [default: all]
--metrics <names>       vmaf,ssim,psnr,ciede,cambi,dssim,tfs [default: all]
--parallel              Full parallelism (no timing)
--fast                  6 fixtures, gifhero+gifski, skip DSSIM/TFS
--list                  Show available fixtures and encoders
```

Visual comparison: `test/bench/viewer.html` (loads `results/latest/results.json`).

### Building the WASM module
```bash
cd packages/imagequant-gif-wasm
source "$HOME/.cargo/env"
RUSTFLAGS="-C target-feature=+bulk-memory,+nontrapping-fptoint" \
  wasm-pack build --target nodejs --release --no-opt \
  --out-dir ../../src/wasm/imagequant-gif
```

### Benchmark metrics

| Metric | Source | What it measures |
|--------|--------|------------------|
| VMAF | ffmpeg libvmaf | Perceptual video quality (0-100, higher=better) |
| CAMBI | ffmpeg libvmaf (no-reference) | Banding artifacts (lower=better) |
| CIEDE2000 | ffmpeg libvmaf | Color accuracy in perceptual color space |
| SSIM | ffmpeg | Structural similarity |
| PSNR | ffmpeg | Peak signal-to-noise ratio |
| DSSIM | dssim CLI | Per-frame structural dissimilarity |

### Parallel encoding
Worker-thread parallelism via `test/bench/parallel.ts`. Each worker gets its own V8 isolate and WASM instance. Achieves 6× speedup on 16 cores.

## Results vs gifski (25 fixtures × 4 resolutions, no lossy LZW)

| Resolution | Size wins | VMAF wins | Avg size Δ | Avg VMAF Δ |
|-----------|-----------|-----------|------------|------------|
| **480p** | **17/25** | **21/25** | **-4%** | **+1.4** |
| **360p** | **21/25** | 17/25 | **-10%** | **+0.9** |
| **240p** | **22/25** | 19/25 | **-13%** | **+1.2** |
| **160p** | **24/25** | 17/25 | **-17%** | **+1.3** |

Smaller files AND better VMAF at every resolution. No lossy LZW.

## Current Phase
Rust port complete. Two delivery targets from one pipeline:

### Native CLI (`packages/gifhero-core`)
- Full pipeline in Rust: probe → quantize → subframe → LZW → GIF
- Rayon parallel: Lanczos3 + LZW across cores, imagequant internal threading
- Multi-file batch encoding: `gifhero *.mp4 -w 480 -o outdir/`
- Sweet spot: 4 concurrent files × 4 threads each → 3.4 files/s (5.2× vs sequential)
- Per-file: ~0.9s for 100 frames at 480p

### Browser SDK
- `gifhero/browser` entry point with fluent API: `gifhero.fromFile(file).fps(20).width(480).toGif()`
- VideoDecoder + Mediabunny demuxer for fast video-to-GIF
- Hybrid TS+WASM pipeline (JS orchestrator + per-frame WASM quantize + WASM Lanczos3)
- Web Worker encoding, ImageBitmap frame storage, progress callbacks, cancellation
- In-browser benchmark comparing gifhero vs gifski-wasm vs gifski CLI

### Presets
- **quality** (q98, speed 1): maximum VMAF, lower staleThreshold, no denoiser
- **balanced** (q90, speed 4): maximum compression, content-adaptive staleThreshold, noise-aware temporal denoiser

Shared pipeline features: palette fitness model (shared palette + fast remap), edge sparse suppression, deferred LZW clear code, power-of-2 palette targeting, keyframe detection, WASM Lanczos3 downscaling, content-adaptive staleThreshold.

### Rust ↔ TypeScript pipeline parity
Validated across 25 fixtures × 4 resolutions × 2 presets = 200 comparisons:
- 118/200 byte-identical output
- 82/200 within ±5% (imagequant threading RNG)
- Max VMAF difference: 0.2 points

## Known Limitations
- **Gradient banding on 256-color content**: smooth gradients across thousands of colors will always show some banding in GIF. Tested noise/grain injection, q100, and dithering variations — all trade 2-5x file size for marginal visual improvement. This is a GIF format ceiling (256 colors per frame), not an encoder limitation. gifski has the same issue.
