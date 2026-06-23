# gifhero

## What This Is
A TypeScript GIF encoding library targeting the browser (Chrome extensions, web apps).
Zero cases >10% larger than gifski across 200 encodes (25 fixtures × 4 resolutions). Wins VMAF at every resolution.

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
  → Probe: static mask, motion × complexity, keyframes
  → Content-adaptive staleThreshold:
      complexity = motionLevel × colorComplexity
      motionFloor = motionLevel > 1% ? 5 : 3
      autoThreshold = clamp(3, 10, round(3 + 7 × min(1, complexity / 5000)))
      threshold = max(motionFloor, autoThreshold)
  → Content-adaptive lossyLzw:
      adaptiveLzw = clamp(preset, 5, round(preset + complexity / 3000))
  → Adaptive maxColors: 192 when colorComplexity ≥ 20000, else 256
  → Shared palette via Histogram (if downscaling OR colorComplexity ≥ 8000)
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
├── run.ts                      Benchmark runner (25 fixtures × 4 resolutions × 2 encoders)
├── parallel.ts                 Worker-thread parallel encoding (6× speedup)
├── encode-worker.ts            Worker script for parallel encoding
├── sensitivity.ts              Parameter sensitivity analysis
├── sweep-exhaustive.ts         Full parameter grid sweep
├── REPORT.md                   Full benchmark report vs gifski
└── references/                 Saved GIF outputs for visual comparison
```

## Presets

### quality (default)
Best visual quality. Background-aware imagequant at maximum precision.
- quantizer: imagequant (q90, speed 1)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4 (adaptive up to 5)
- optimize: subframe, content-adaptive staleThreshold, keyframe detection, adaptive maxColors

### balanced
Good quality with smaller files.
- quantizer: imagequant (q80, speed 3)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4 (adaptive up to 5)
- optimize: subframe, content-adaptive staleThreshold, keyframe detection, adaptive maxColors

### speed
Fastest encoding. Uses NeuQuant instead of imagequant WASM.
- quantizer: neuquant (quality 20)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 0
- optimize: subframe, content-adaptive staleThreshold, keyframe detection

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

## Results vs gifski (200 encodes, 25 fixtures × 4 resolutions)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ |
|-----------|-----------|-----------|------------|
| **480p** | **12/25** | **22/25** | **+0.5** |
| **360p** | **12/25** | **23/25** | **+0.7** |
| **240p** | **16/25** | **25/25** | **+1.6** |
| **160p** | **20/25** | **24/25** | **+2.5** |

**Zero cases >10% larger than gifski. Zero VMAF losses >2 points.**

## Current Phase
Phase 6 complete. Three content-adaptive optimizations reduce file size without relying on aggressive lossy LZW:
1. Conditional shared palette (colorComplexity ≥ 8000 at native res, always when downscaling) for cross-frame LZW consistency
2. Adaptive maxColors (192 when colorComplexity ≥ 20000) to reduce dithering noise on high-diversity content
3. Adaptive lossyLzw capped at 5 (not 6) from probe motion × color complexity
