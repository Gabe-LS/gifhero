# gifhero

The highest-compression GIF encoder. Browser SDK + native CLI.

gifhero produces **14% smaller files than gifski** — the previous state of the art — at equal or better perceptual quality, validated across 25 diverse video fixtures at 4 resolutions (800 encodes).

## Why gifhero

Every GIF encoder makes you choose between file size and quality. gifhero doesn't.

```
Size (KB)                     Quality (VMAF)
    ◄── smaller    larger ──►     ◄── worse    better ──►

    gifski-lossy ████░░░░░░░░     gifski-lossy █████████░░░  94.4
    gifhero-bal  █████░░░░░░░     gifhero-bal  █████████░█░  96.5  ◄── best ratio
    gifhero-q    ██████░░░░░░     gifhero-q    ██████████░░  96.9
    gifski       ███████░░░░░     gifski       █████████░░░  96.3
    ffmpeg+gsc   █████████░░░     ffmpeg+gsc   █████████░█░  97.1
    ffmpeg       ██████████░░     ffmpeg       ██████████░░  97.6
    magick       █████████████    magick       ██████████░░  98.0
```

gifhero balanced sits in a unique position: **smaller than gifski, higher quality than gifski-lossy, and competitive VMAF with tools that produce 2× larger files.**

## Benchmark results

Tested on 25 fixtures (Big Buck Bunny clips, screencasts, talking heads, fast action, gradients, pixel art, and more) at 4 resolutions (native 480p, 360p, 240p, 160p). All quality metrics computed with ffmpeg libvmaf, dssim, and custom temporal flicker scoring.

### gifhero balanced vs all encoders (25 fixtures, native 480p)

| Encoder | Total size | Avg VMAF | Avg SSIM | Avg DSSIM | vs gifhero size |
|---------|-----------|----------|----------|-----------|-----------------|
| **gifhero balanced** | **55.6 MB** | **96.5** | **0.9726** | **0.0018** | — |
| gifhero quality | 59.8 MB | 96.9 | 0.9754 | 0.0014 | +8% |
| gifski (q90) | 64.4 MB | 96.3 | 0.9729 | 0.0031 | +16% |
| gifski-lossy (q80/lq80) | 51.5 MB | 94.4 | 0.9630 | 0.0047 | -7% |
| ffmpeg (palettegen) | 102.0 MB | 97.6 | 0.9660 | 0.0009 | +83% |
| ffmpeg-hq (per-frame) | 146.8 MB | 95.7 | 0.9610 | 0.0175 | +164% |
| ImageMagick | 137.5 MB | 98.0 | 0.9544 | 0.0025 | +147% |
| ffmpeg + gifsicle | 84.4 MB | 97.1 | 0.9584 | 0.0030 | +52% |

**Key findings:**
- gifhero balanced is **14% smaller than gifski** with +0.1 VMAF and equivalent SSIM
- gifhero quality is **7% smaller than gifski** with +0.5 VMAF
- gifski-lossy saves 7% over gifhero but loses 2.0 VMAF points — visible quality degradation
- ffmpeg and ImageMagick produce 83-164% larger files despite similar or slightly higher VMAF
- gifhero has the lowest DSSIM (structural dissimilarity) of any encoder except ffmpeg

### How compression scales with resolution

| Resolution | gifhero size wins | Total size Δ | Avg VMAF Δ | Avg SSIM Δ |
|-----------|-------------------|-------------|------------|------------|
| **480p** (native) | **22/25** | **-14%** | +0.1 | -0.0003 |
| **360p** | **23/25** | **-14%** | +0.1 | -0.0008 |
| **240p** | **24/25** | **-14%** | +0.5 | +0.0011 |
| **160p** | **24/25** | **-14%** | +0.5 | +0.0023 |

gifhero's compression advantage is consistent across all resolutions. At lower resolutions (240p, 160p), gifhero's VMAF advantage grows — the sub-frame pipeline's transparency optimization becomes more effective as pixel counts decrease.

### Per-fixture breakdown (balanced vs gifski, native 480p)

| Fixture | gifhero | gifski | Size Δ | VMAF Δ | Content type |
|---------|---------|--------|--------|--------|--------------|
| screencast | 15 KB | 50 KB | **-69%** | 0.0 | UI recording |
| bbb-clip-01 | 3,105 KB | 4,775 KB | **-35%** | -1.4 | Animated film |
| bbb-clip-04 | 1,372 KB | 2,102 KB | **-35%** | -1.1 | Animated film |
| big-buck-bunny | 2,194 KB | 3,172 KB | **-31%** | +0.0 | Animated film |
| bbb-clip-05 | 1,565 KB | 2,269 KB | **-31%** | -1.2 | Nature scene |
| skin-tones | 133 KB | 180 KB | **-26%** | +0.1 | Portrait |
| bbb-clip-09 | 1,302 KB | 1,730 KB | **-25%** | -0.5 | Mixed scene |
| city-night | 3,251 KB | 4,182 KB | **-22%** | -0.3 | Urban |
| fast-action | 3,836 KB | 3,282 KB | +17% | **+3.2** | Sports/motion |
| shapes | 344 KB | 398 KB | **-14%** | **+3.0** | Synthetic |
| sintel | 1,260 KB | 1,457 KB | **-13%** | +0.1 | Film |
| talking-head | 1,121 KB | 1,223 KB | **-8%** | -0.2 | Webcam |
| jellyfish | 2,640 KB | 2,939 KB | **-10%** | -0.8 | Nature |

gifhero wins on file size in 22/25 fixtures. On the 3 where gifski is smaller, gifhero has significantly higher VMAF (+3.2 on fast-action, +0.1 on bbb-clip-08).

### Why gifhero produces smaller files

GIF structural analysis reveals the difference:

| | gifhero | gifski | ffmpeg | ImageMagick |
|---|---|---|---|---|
| **Bits per pixel** | 1.52 | 1.79 | 2.83 | 4.01 |
| **Sub-frame usage** | 42% | 40% | 32% | 9% |
| **Avg palette size** | 188 | 244 | global | 226 |
| **Transparency** | 84% | 97% | 97% | 58% |

gifhero's sub-frame pipeline probes the video content before encoding:
1. **Static pixel detection** — pixels that never change across all frames become unconditionally transparent
2. **Canvas-aware quantization** — imagequant's `set_background` blends dithering with the previously decoded frame
3. **Adaptive palette trimming** — unused palette entries are evicted to cross power-of-2 boundaries, reducing LZW minimum code size
4. **Content-adaptive thresholds** — motion level and color complexity drive per-frame transparency and compression decisions
5. **Lossy LZW with deferred clear** — Chebyshev distance matching for approximate dictionary lookups, with dictionary clear deferred until compression ratio degrades

## Install

### Browser SDK

```bash
npm install gifhero
```

```typescript
import { gifhero } from "gifhero/browser";

const gif = await gifhero
  .fromFile(videoFile)
  .fps(20)
  .width(480)
  .preset("balanced")
  .toGif();
```

### Native CLI

```bash
cd packages/gifhero-core
cargo build --release --features cli
```

```bash
# Single file
gifhero input.mp4 -w 480 --fps 20 -o output.gif

# Batch encode (parallel)
gifhero video1.mp4 video2.mp4 video3.mp4 -w 480 -o outdir/

# Quality preset
gifhero input.mp4 -w 480 --preset quality -o output.gif
```

Requires ffmpeg on PATH for video decoding.

## Presets

| | balanced (default) | quality |
|---|---|---|
| **Optimized for** | File size | VMAF |
| **imagequant quality** | 95 | 98 |
| **Temporal denoise** | Yes (noise-aware gate) | No |
| **staleThreshold** | 5 (adaptive, per-frame boost) | 4 (adaptive) |
| **maxColors** | 192 at high complexity | 224 at high complexity |
| **vs gifski size** | 14% smaller | 7% smaller |
| **vs gifski VMAF** | +0.1 | +0.5 |

Both presets share: WASM Lanczos3 downscaling, conditional shared palette, adaptive lossy LZW (capped at 5), deferred LZW clear code, power-of-2 palette targeting, keyframe detection, motion-adjusted staleThreshold.

## Encode speed

| Target | Time | Notes |
|--------|------|-------|
| gifhero CLI (Rust + Rayon) | ~0.9s / 100 frames | 16-core parallel Lanczos3 + LZW |
| gifhero browser (TS + WASM) | ~3s / 100 frames | Single-threaded, hybrid pipeline |
| gifski CLI | ~0.3s / 100 frames | 16-core parallel quantization |

gifski is ~3× faster per file because it parallelizes quantization across frames. gifhero can't — the sub-frame pipeline requires sequential canvas tracking (each frame's transparency depends on the previous frame's decoded output). This sequential dependency is the cost of producing 14% smaller files.

For batch workloads, gifhero's CLI processes multiple files in parallel:

```bash
# 4 concurrent files × 4 threads each on 16 cores
gifhero *.mp4 -w 480 -o outdir/
# Throughput: 3.4 files/second (5.2× vs sequential)
```

## Browser sources

```typescript
import { gifhero } from "gifhero/browser";

// Video file (fastest — uses VideoDecoder + Mediabunny demuxer)
gifhero.fromFile(file).fps(20).width(480).toGif()

// Canvas element
gifhero.fromCanvas(canvas, { frameCount: 30 }).fps(10).toGif()

// MediaStream (webcam)
gifhero.fromStream(stream).fps(10).duration(3).width(240).toGif()
```

## CLI options

```
gifhero [OPTIONS] <INPUTS>...

Arguments:
  <INPUTS>...  Input video files (any format ffmpeg supports)

Options:
  -o, --output <PATH>    Output path (file or directory)
  -w, --width <PX>       Target width (height auto)
      --height <PX>      Target height
      --fps <N>          Frames per second [default: 20]
      --preset <NAME>    quality | balanced [default: balanced]
      --max-duration <S> Maximum duration in seconds
  -j, --threads <N>      Threads per file [default: auto]
  -q, --quiet            Suppress output
```

## How it works

Two-pass pipeline: **probe** then **encode**.

**Pass 1 — Probe** scans all frames in < 100ms:
- Per-pixel min/max tracking → static mask (pixels that never change)
- Motion level (avg fraction of pixels changing per frame)
- Color complexity (distinct 6-bit quantized colors)
- Scene change detection (>60% pixels change) and motion-to-static transitions

**Pass 2 — Encode** uses probe results to drive every decision:
1. Temporal denoise (balanced only): 3-frame median filter, triggered only when sub-perceptual noise is detected
2. WASM Lanczos3 downscale (12× faster than pure JS, bit-identical output)
3. Shared palette via imagequant Histogram (when color complexity > 8K or downscaling)
4. Per-frame: alpha-zero static + stale pixels → imagequant with `set_background` → bbox crop → palette trim (power-of-2) → lossy LZW with deferred clear
5. GIF89a assembly with local color tables

## Architecture

```
Browser:
  VideoDecoder → Mediabunny demux → frame extraction
  → JS orchestrator → WASM quantize (per frame) → WASM Lanczos3
  → JS sub-frame → JS LZW → GIF

CLI (Rust):
  ffmpeg → raw RGBA frames
  → Rayon parallel Lanczos3 → sequential quantize + sub-frame
  → Rayon parallel LZW → GIF
```

The full pipeline exists in both TypeScript (browser) and Rust (CLI). The Rust port was validated across 200 comparisons (25 fixtures × 4 resolutions × 2 presets): 118 byte-identical, rest within ±5% from imagequant threading nondeterminism, max 0.2 VMAF difference.

## Development

```bash
npm run build        # Build TypeScript bundles
npm run test         # Run vitest (52 tests)

# Benchmark (configurable)
npx tsx test/bench/run-sample.ts --list                          # show fixtures & encoders
npx tsx test/bench/run-sample.ts --fixtures bbb-clip-01,candle-flame --encoders gifhero-balanced,gifski
npx tsx test/bench/run-sample.ts --resolutions 0,360,240,160     # full multi-resolution
npx tsx test/bench/run-sample.ts --keep-gifs                     # retain output GIFs

# Rust CLI
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

## Benchmark methodology

- **25 test fixtures**: 10 Big Buck Bunny clips, animated films (Sintel), screencasts, talking heads, fast action sports, jellyfish, gradients, pixel art, skin tones, solid colors
- **4 resolutions**: native 480p, 360p, 240p, 160p
- **8 encoders**: gifhero balanced, gifhero quality, gifski (q90), gifski-lossy (q80/lq80), ffmpeg (palettegen + floyd-steinberg), ffmpeg-hq (per-frame palette), ImageMagick (OptimizePlus + OptimizeTransparency), ffmpeg + gifsicle (-O3 --lossy=80)
- **Quality metrics**: VMAF (Netflix perceptual quality), SSIM (structural similarity), DSSIM (per-frame structural dissimilarity), PSNR, CIEDE2000 (perceptual color accuracy), CAMBI (banding detection)
- **GIF structural analysis**: bits per pixel, sub-frame coverage, palette sizes, transparency usage, disposal methods, frame delays — via gifsicle --sinfo
- **All results reproducible**: `npx tsx test/bench/run-sample.ts --keep-gifs`

## License

MIT
