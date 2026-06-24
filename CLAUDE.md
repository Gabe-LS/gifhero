# gifhero

## What This Is
A TypeScript GIF encoding library targeting the browser (Chrome extensions, web apps).
Zero cases >5% larger than gifski across 200 encodes (25 fixtures × 4 resolutions). Wins VMAF at every resolution.

## Tech Stack
- TypeScript (strict mode), targeting ES2020
- Build: tsup (ESM + CJS dual output)
- Test: vitest
- Custom libimagequant WASM with `set_background` / `set_importance_map` for native GIF transparency
- Lanczos3 downscaling (pure JS, no DOM)
- No runtime dependencies (WASM quantizer is an optional peer dep)

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

### Pass 2: Encode

Optional Lanczos3 downscaling via `targetWidth`, then two quantizer paths selected automatically:

#### Background-aware path (default when WASM available)

Uses the custom `imagequant-gif` WASM module (`src/quantizers/imagequant-gif.ts`):

```
Source frames
  → Lanczos3 downscale (if targetWidth set)
  → Temporal denoise (balanced only, noise-aware gate)
  → Probe: static mask, motion × complexity, keyframes
  → Content-adaptive staleThreshold:
      quality: base 4, motionFloor 4/5
      balanced: base 5, per-frame boost (+1 on near-static frames)
  → Content-adaptive lossyLzw:
      adaptiveLzw = clamp(preset, 5, round(preset + complexity / 3000))
  → Adaptive maxColors:
      quality: 224 when colorComplexity ≥ 30K
      balanced: 192 when colorComplexity ≥ 20K
  → Shared palette via Histogram (if downscaling OR colorComplexity ≥ 8000)
  → Deferred LZW clear code (continue matching when dictionary full)
  → Power-of-2 palette targeting (evict entries to cross bit boundary)
  → Frame 0 / keyframes: quantizeSimple() → full-frame, reset canvas
  → Frames 1+:
      1. Zero alpha on static-mask pixels
      2. Zero alpha on pixels where source ≈ canvas (≤ staleThreshold)
      3. quantizeWithBackground(frame, canvas, importanceMap)
         → libimagequant natively produces transparent pixels
         → Dithering blends seamlessly with canvas via set_background
         → Palette focused on changed pixels via importance map
      4. Compute tight bbox of non-transparent pixels
      5. Crop indexed output to bbox
      6. Trim palette to used entries
      7. Composite opaque pixels onto canvas for next frame
  → Adaptive lossy LZW → GIF89a writer
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

### Downscaling (`src/resize.ts`)

Lanczos3 (sinc-windowed sinc) resampling — the same algorithm used by libswscale, Photoshop, and ImageMagick. Two-pass separable filter with correct alpha handling. Pure RGBA arithmetic, no DOM or canvas dependency. Works in browser and workers.

### Custom WASM module (`packages/imagequant-gif-wasm`)

Rust crate wrapping libimagequant v4 with wasm-bindgen. Exposes:

- `quantize_with_background()` — the key API gifski uses. Passes the decoded canvas as background so dithering blends seamlessly at transparency boundaries.
- `quantize_simple()` — standard quantization for frame 0.
- `quantize_no_dither()` — nearest-color mapping without error diffusion.
- `set_importance_map()` — de-prioritizes static pixels in palette allocation.
- `build_shared_palette()` — pools sampled frames via Histogram for multi-frame shared palette.
- `remap_with_palette()` — remaps frame with pre-built palette + background awareness.

Built with `wasm-pack --target nodejs --no-opt` (122KB WASM binary). Pre-built output checked into `src/wasm/imagequant-gif/`.

### File structure

```
src/
├── index.ts                    Main encode() API, presets, two-pass pipeline
├── probe.ts                    Pre-encode frame analysis (static mask, motion, keyframes)
├── resize.ts                   Lanczos3 downscaling (pure JS)
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
└── imagequant-gif-wasm/        Rust crate for custom libimagequant WASM
    ├── Cargo.toml
    └── src/lib.rs

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
Maximum VMAF, never >5% larger than gifski. Best for visual fidelity.
- quantizer: imagequant (q90, speed 1)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4 (adaptive up to 5)
- staleThreshold: base 4, motionFloor 4/5
- maxColors: 256 (224 when colorComplexity ≥ 30K)
- No per-frame threshold boost

### balanced (default)
Maximum compression. Best for file size.
- quantizer: imagequant (q90, speed 1)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4 (adaptive up to 5)
- staleThreshold: base 5, per-frame boost (+1 on near-static frames)
- maxColors: 256 (192 when colorComplexity ≥ 20K)
- Noise-aware temporal denoiser (3-frame median, threshold 3)

Both presets share: conditional shared palette (colorComplexity ≥ 8K or downscaling), keyframe detection, Lanczos3 downscaling, deferred LZW clear, power-of-2 palette targeting.

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
- `npm run bench` — full benchmark (25 fixtures × 4 resolutions)
- `npm run bench:fast` — fast benchmark (6 fixtures × 4 encoders)
- `npm run bench -- --parallel` — parallel mode (worker threads + batched VMAF)

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

## Results vs gifski (25 fixtures × 4 resolutions)

### quality preset (VMAF-optimized)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|------------|
| **480p** | **12/25** | **23/25** | **+0.4** | **-14%** |
| **360p** | **14/25** | **23/25** | **+0.7** | **-14%** |
| **240p** | **18/25** | **24/25** | **+1.6** | **-13%** |
| **160p** | **21/25** | **25/25** | **+2.5** | **-15%** |

### balanced preset (size-optimized)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|------------|
| **480p** | **7/25** | **24/25** | **+0.0** | **-18%** |
| **360p** | **7/25** | **24/25** | **+0.1** | **-19%** |
| **240p** | **14/25** | **25/25** | **+1.0** | **-19%** |
| **160p** | **17/25** | **25/25** | **+1.7** | **-19%** |

**Zero cases >5% larger than gifski on either preset. Zero VMAF losses >2 points.**

## Current Phase
Phase 8 complete. Two presets for different priorities:
- **quality**: VMAF-optimized — lower staleThreshold (base 4), full maxColors, no per-frame boost, no denoiser
- **balanced**: size-optimized — higher staleThreshold (base 5), adaptive maxColors (192 at ≥20K), per-frame threshold boost, noise-aware temporal denoiser (3-frame median, dual gate: sub-perceptual >5% AND motion >2%)

Shared pipeline features: conditional shared palette, adaptive lossyLzw (capped at 5), deferred LZW clear code, power-of-2 palette targeting, keyframe detection, Lanczos3 downscaling.

## Known Limitations
- **Gradient banding on 256-color content**: smooth gradients across thousands of colors will always show some banding in GIF. Tested noise/grain injection, q100, and dithering variations — all trade 2-5x file size for marginal visual improvement. This is a GIF format ceiling (256 colors per frame), not an encoder limitation. gifski has the same issue.
