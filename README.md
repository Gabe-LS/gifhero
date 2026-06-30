# gifhero

The highest-compression GIF encoder. Browser SDK + native CLI.

gifhero produces **smaller files than gifski** on 68% of fixtures with **better VMAF on 84%** — validated across 25 diverse video fixtures at 4 resolutions, without lossy LZW compression.

## Why gifhero

Every GIF encoder makes you choose between file size and quality. gifhero doesn't.

```
Size (KB)                     Quality (VMAF)
    ◄── smaller    larger ──►     ◄── worse    better ──►

    gifhero      █████░░░░░░░     gifhero      ██████████░░  96.8
    gifski       ██████░░░░░░     gifski       █████████░░░  96.1
    ffmpeg+gsc   █████████░░░     ffmpeg+gsc   █████████░█░  97.1
    ffmpeg       ██████████░░     ffmpeg       ██████████░░  97.6
    magick       █████████████    magick       ██████████░░  98.0
```

gifhero is smaller than gifski on most content AND higher quality — without any lossy LZW tricks.

## Benchmark results

25 fixtures × 4 resolutions. Full results in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

### gifhero vs gifski (25 fixtures)

| Resolution | Size wins | VMAF wins | Avg size Δ | Avg VMAF Δ |
|-----------|-----------|-----------|------------|------------|
| **480p** | **17/25** | **21/25** | **-4%** | **+1.4** |
| **360p** | **21/25** | 17/25 | **-10%** | **+0.9** |
| **240p** | **22/25** | 19/25 | **-13%** | **+1.2** |
| **160p** | **24/25** | 17/25 | **-17%** | **+1.3** |

Smaller files AND better VMAF at every resolution. No lossy LZW.

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
```

Requires ffmpeg on PATH for video decoding.

## Encode speed

| | Per file (480p, 100 frames) | Notes |
|---|---|---|
| gifhero SDK (Node.js) | ~4s | TS + WASM pipeline |
| gifhero CLI (Rust) | ~0.9s | Parallel Lanczos3 + LZW |
| gifski CLI | ~0.3s | Parallel quantization |

gifski is faster because it parallelizes quantization across frames. gifhero can't — the sub-frame pipeline requires sequential canvas tracking (each frame's transparency depends on the previous decoded frame).

### Per-stage timing (bbb-clip-01, 100 frames, 480p)

| Stage | Time | % |
|-------|------|---|
| quantize | 2.0s | 47% |
| transparency | 0.6s | 14% |
| write (LZW + GIF) | 0.3s | 7% |
| denoise | 0.2s | 5% |
| probe | 0.1s | 3% |

Batch throughput (Rust CLI): **3.4 files/s** at 4 concurrent files on 16 cores.

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
- Scene change detection and motion-to-static transitions

**Pass 2 — Encode** uses probe results to drive every decision:
1. Temporal denoise: 3-frame median filter, triggered only when sub-perceptual noise is detected
2. WASM Lanczos3 downscale (12× faster than pure JS, bit-identical output)
3. Palette fitness model: build shared palette at keyframes, fast remap on subsequent frames, rebuild when palette fitness degrades
4. Per-frame: alpha-zero static + stale pixels → imagequant with `set_background` → edge sparse suppression → bbox crop → palette trim (power-of-2) → LZW with deferred clear
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

## Development

```bash
npm run build        # Build TypeScript bundles
npm run test         # Run vitest (52 tests)

# Benchmark (two modes)
npm run bench            # Sequential encoding (accurate timing) + parallel metrics
npm run bench:fast       # Fast: 6 fixtures, gifhero + gifski only
npm run bench:parallel   # Full parallelism: ~5× faster, no timing capture

# Custom runs
npx tsx test/bench/run.ts --list                                    # Show fixtures & encoders
npx tsx test/bench/run.ts --fixtures bbb-clip-01,talking-head       # Specific fixtures
npx tsx test/bench/run.ts --encoders gifhero,gifski --metrics vmaf  # Specific config
npx tsx test/bench/run.ts --parallel --resolutions 480              # Fast parallel, one resolution

# Visual comparison
open test/bench/viewer.html    # A/B viewer (loads results/latest/)

# Rust CLI
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

## Benchmark methodology

25 fixtures (animation, screencasts, webcam, sports, gradients, pixel art) × 4 resolutions. gifhero vs gifski at default settings, no lossy LZW. Quality measured via VMAF. Each run produces a timestamped directory with GIFs and JSON results. Full methodology and per-fixture tables in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## License

MIT
