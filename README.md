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

25 fixtures × 4 resolutions × 8 encoders. Full results in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

### gifhero balanced vs gifski (25 fixtures)

| Resolution | Size wins | vs gifski | Avg VMAF Δ |
|-----------|-----------|-----------|------------|
| **480p** | 22/25 | **-14%** | +0.1 |
| **360p** | 23/25 | **-14%** | +0.3 |
| **240p** | 24/25 | **-14%** | +1.3 |
| **160p** | 24/25 | **-14%** | +2.0 |

Zero VMAF losses >2 points. Compression advantage is consistent across all resolutions.

### All encoders (480p)

| Encoder | Total size | Avg VMAF | vs gifhero |
|---------|-----------|----------|------------|
| **gifhero balanced** | **55.6 MB** | **96.5** | — |
| gifhero quality | 59.8 MB | 96.9 | +8% |
| gifski (q90) | 64.4 MB | 96.3 | +16% |
| gifski-lossy (q80) | 51.5 MB | 94.4 | -7% |
| ffmpeg + gifsicle | 84.4 MB | 97.1 | +52% |
| ffmpeg | 102.0 MB | 97.6 | +83% |
| ImageMagick | 137.5 MB | 98.0 | +147% |

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

| | Per file (480p, 100 frames) | Notes |
|---|---|---|
| gifhero CLI (Rust) | ~0.9s | Parallel Lanczos3 + LZW |
| gifski CLI | ~0.3s | Parallel quantization |
| gifhero SDK (Node.js) | ~2.7s | TS + WASM pipeline |

gifski is ~3× faster per file because it parallelizes quantization across frames. gifhero can't — the sub-frame pipeline requires sequential canvas tracking. This is the cost of 14% smaller files.

Batch throughput: **3.4 files/s** at 4 concurrent files on 16 cores (5.2× vs sequential).

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

25 fixtures (animation, screencasts, webcam, sports, gradients, pixel art) × 4 resolutions × 8 encoders. Quality measured via VMAF, SSIM, DSSIM, PSNR, CIEDE2000, and CAMBI. Full methodology, per-fixture tables, and structural analysis in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## License

MIT
