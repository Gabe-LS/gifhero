# gifhero

## What This Is
A TypeScript GIF encoding library targeting the browser (Chrome extensions, web apps).
Goal: gifski-level quality in pure JS/WASM.

## Tech Stack
- TypeScript (strict mode), targeting ES2020
- Build: tsup (ESM + CJS dual output)
- Test: vitest
- No runtime dependencies (WASM quantizer is an optional peer dep)

## Conventions
- Pure functions where possible. No classes unless managing stateful resources (workers, WASM instances).
- All pixel data as Uint8Array or Uint8ClampedArray.
- Every public function has JSDoc with @param and @returns.
- Error messages must be actionable ("Frame 3 has 0 pixels — did you pass an empty canvas?" not "Invalid input").
- Never mutate input data. Clone if needed.

## Architecture

The encoding pipeline has two paths: a **sub-frame pipeline** (default, all presets) and a **legacy pipeline** (backward compat when users pass `optimize: { frameDiff: true }` without `subframe: true`).

### Sub-frame pipeline (default)

```
Source frames
  → Auto-global palette detection (imagequant probe, < 64 colors → shared palette)
  → Frame 0: full-frame quantize → decode to canvas
  → Frames 1+:
      1. Find bbox: source[N] vs source[N-1] (cropTolerance) OR source[N] vs canvas (holeTolerance)
      2. Crop source to bbox
      3. Quantize crop (imagequant or F-S with global/neuquant palette)
      4. Hole-punch vs canvas: unchanged pixels → transparent
      5. Stale transparency check: verify canvas matches palette's nearest color (distance > 3 → opaque)
      6. Morphological noise gate (5×5, density < 6 → remove)
      7. Transparency run equalization (6+ transparent neighbors, source vs canvas ≤ 3 → transparent)
      8. Trim palette to used entries
      9. Tight crop to non-transparent bbox
      10. Composite onto canvas for next frame
  → Lossy LZW (optional)
  → GIF89a writer
```

Key insight: hole punching and bbox detection compare against the **decoded canvas** (what the GIF decoder actually displays), not the previous source frame. This prevents ghost trails from stale dithering artifacts.

### File structure

```
src/
├── index.ts                    Main encode() API, presets, pipeline orchestration
├── quantizers/
│   ├── neuquant.ts             NeuQuant neural network quantizer (256 colors)
│   └── imagequant.ts           libimagequant WASM wrapper (adaptive palette size)
├── dither/
│   ├── floyd-steinberg.ts      Floyd-Steinberg error diffusion + mapNearest
│   └── temporal.ts             Temporal dithering (disabled in presets)
├── optimize/
│   ├── subframe.ts             Sub-frame encoding: cropRgba, findChangedBbox,
│   │                           buildSubframe, compositeOntoCanvas, trimPalette
│   ├── frame-diff.ts           Legacy RGBA-based frame differencing
│   ├── disposal.ts             Disposal method optimization
│   ├── palette-strategy.ts     Palette strategies: local, global, crossframe, adaptive
│   ├── palette-sort.ts         Luminance-based palette sorting (no effect with imagequant)
│   └── stabilize.ts            Post-dither pixel stabilization (superseded by subframe)
├── encoder/
│   ├── gif-writer.ts           GIF89a binary writer (headers, LCT/GCT, GCE, sub-blocking)
│   ├── lzw.ts                  Standard LZW encoder
│   └── lossy-lzw.ts            Lossy LZW with Chebyshev distance matching
└── types/                      TypeScript declarations for WASM modules
```

## Presets

### quality
Best visual quality. Imagequant at maximum precision.
- quantizer: imagequant (q90, speed 1)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4
- optimize: subframe, cropTolerance 5, holeTolerance 0, transparencyEqualization on

### balanced (default)
Good quality with smaller files.
- quantizer: imagequant (q80, speed 3)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 4
- optimize: subframe, cropTolerance 5, holeTolerance 0, transparencyEqualization on

### speed
Fastest encoding. Uses NeuQuant instead of imagequant WASM.
- quantizer: neuquant (quality 20)
- dither: floyd-steinberg (serpentine)
- lossyLzw: 0
- optimize: subframe, cropTolerance 5, holeTolerance 0, transparencyEqualization on

All presets auto-detect low-color content (< 64 used colors) and switch to a shared global palette, trimmed to used entries only.

## Commands
- `npm run build` — build with tsup
- `npm run test` — run vitest (52 tests)
- `npm run bench` — full benchmark (15 fixtures × 6 encoders, ~10 min)
- `npm run bench:fast` — fast benchmark (6 fixtures × 4 encoders, ~2 min)
- `npm run bench -- --parallel` — run fixtures concurrently (timing unreliable)
- `npm run bench -- --fast --parallel` — fast + parallel

### Benchmark metrics

The benchmark runner (`test/bench/run.ts`) measures quality with multiple metrics:

| Metric | Source | What it measures |
|--------|--------|------------------|
| VMAF | ffmpeg libvmaf | Perceptual video quality (0-100, higher=better) |
| CAMBI | ffmpeg libvmaf (no-reference) | Banding artifacts (lower=better) |
| CIEDE2000 | ffmpeg libvmaf | Color accuracy in perceptual color space |
| SSIM | ffmpeg | Structural similarity |
| PSNR | ffmpeg | Peak signal-to-noise ratio |
| DSSIM | dssim CLI | Per-frame structural dissimilarity |
| TFS | custom (test/metrics/flicker.ts) | Temporal flicker score across frames |

`--fast` mode skips TFS and DSSIM. Results are saved as JSON in `test/bench/results/`. GIF outputs are copied to `test/bench/references/` for visual inspection.

### Fast fixture list
big-buck-bunny, jellyfish, candle-flame, screencast, talking-head, skin-tones

## Known Issues

- **big-buck-bunny / city-night size regression**: Per-frame imagequant palettes add ~45KB overhead (768 bytes × 60 frames) compared to gifski's shared palette approach. Quality/balanced are +28-42% larger than gifski on high-motion content. VMAF is +0.1-1.0 higher.
- **skin-tones file size**: Auto-global palette triggers (17-30 colors) but file is still +28% larger than gifski (364KB vs 284KB) due to the stale-transparency check making more pixels opaque for edge correctness.
- **shapes VMAF gap**: 95.2 vs gifski's 97.1. Inherent to per-frame imagequant palettes on synthetic content with hard color boundaries — not a bug.
- **Temporal dithering disabled**: Index locking for unchanged pixels caused spatial F-S distribution errors. Disabled in all presets; code exists in `src/dither/temporal.ts`.
- **palette-sort.ts has no effect**: Imagequant already structures palettes optimally. Kept as an optional utility.

## Current Phase
Phase 3b complete. Sub-frame encoding pipeline with canvas-aware hole punching, transparency equalization, palette trimming, and auto-global palette detection. Lossy LZW with transparent index preservation. All presets wired and benchmarked against gifski across 15 fixtures.
