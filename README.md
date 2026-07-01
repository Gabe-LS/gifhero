# gifhero

An experiment in GIF encoding — exploring whether two weeks of intensive AI-assisted development could meaningfully improve on the state of the art established by [gifski](https://gif.ski/).

## The short answer

Barely. gifski is an outstanding piece of engineering by [Kornel Lesiński](https://kornel.ski/), and after building an entire encoder from scratch — with a browser SDK, a Rust CLI, a custom WASM pipeline, and a 25-fixture benchmark suite — the compression gains are real but modest: **4–17% smaller files** depending on resolution, with slightly better perceptual quality (+0.7 VMAF). gifski remains **4× faster** and has years of battle-tested production use.

<p align="center">
  <img src="docs/benchmark-chart.png" alt="gifhero vs gifski and other encoders: file size and VMAF quality comparison across 25 fixtures">
</p>

The improvements come from a sub-frame transparency pipeline that gifski doesn't use — texture-aware thresholding, edge sparse suppression, palette fitness reuse, direction-aware forward-look — but these techniques require sequential canvas tracking, which is exactly why gifhero is slower. gifski's parallel quantization architecture is the right tradeoff for most use cases.

## What this project demonstrates

This was built entirely with [Claude Code](https://claude.ai/code) over ~2 weeks. The codebase includes:

- A TypeScript browser SDK with a fluent API and WASM-powered encoding
- A native Rust CLI with Rayon parallelism
- A custom libimagequant WASM module with `set_background` support
- A unified `FrameEncoder` that runs the entire per-frame pipeline in a single WASM call
- A benchmark suite comparing 6 encoders across 25 fixtures × 4 resolutions
- Full Rust ↔ TypeScript pipeline parity

The real takeaway isn't "gifhero is better than gifski" — it's that AI-assisted development can produce a complete, tested, benchmarked encoder in days rather than months, and that even against excellent existing tools, there's room for marginal improvement through different architectural choices.

## Benchmark results

25 fixtures × 4 resolutions. Both encoders at default settings. Full results in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

### gifhero vs gifski

| Resolution | Size wins | VMAF wins | Avg size Δ | Avg VMAF Δ |
|-----------|-----------|-----------|------------|------------|
| **480p** | **17/25** | **21/25** | **-4%** | **+1.4** |
| **360p** | **21/25** | 17/25 | **-10%** | **+0.9** |
| **240p** | **22/25** | 19/25 | **-13%** | **+1.2** |
| **160p** | **24/25** | 17/25 | **-17%** | **+1.3** |

### Encode speed

| | Per file (100 frames, 720p → 480p) |
|---|---|
| gifski CLI | **~0.3s** |
| gifhero CLI (Rust) | ~1.3s |
| gifhero SDK (Node.js) | ~14s |

gifski is 4× faster. It parallelizes quantization across frames — something gifhero can't do because its sub-frame pipeline requires sequential canvas tracking. This is the fundamental tradeoff: gifhero trades speed for compression.

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
brew install Gabe-LS/tap/gifhero
```

Or build from source:
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

## How it works

Two-pass pipeline: **probe** then **encode**.

**Pass 1 — Probe** scans all frames in < 100ms:
- Per-pixel min/max tracking → static mask (pixels that never change)
- Motion level, color complexity, gradient density
- Scene change detection and motion-to-static transitions

**Pass 2 — Encode** uses probe results to drive every decision:
1. Temporal denoise: 3-frame median filter, triggered only when sub-perceptual noise is detected
2. WASM Lanczos3 downscale (12× faster than pure JS, bit-identical output)
3. Palette fitness model: build shared palette at keyframes, fast remap on subsequent frames, rebuild when palette fitness degrades (p95 nearest-color distance > 8)
4. Per-frame: texture-aware threshold + direction-aware forward-look → alpha-zero static + stale pixels → imagequant with `set_background` → edge sparse suppression → bbox crop → palette trim (power-of-2) → LZW with deferred clear
5. GIF89a assembly with local color tables

## Architecture

```
Browser SDK:
  VideoDecoder → Mediabunny demux → frame extraction
  → JS orchestrator → WASM FrameEncoder (transparency + quantize + subframe per frame)
  → WASM Lanczos3 → JS LZW → GIF

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
open docs/viewer/index.html    # A/B comparison viewer

# Rust CLI
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

## Acknowledgments

This project exists because of the excellent foundation laid by [gifski](https://gif.ski/) and its author [Kornel Lesiński](https://kornel.ski/). gifski's use of libimagequant with background-aware dithering — the `set_background` API that makes transparent pixels blend seamlessly — is the core insight that makes high-quality GIF sub-framing possible. gifhero builds on this same library and approach. If you need a fast, reliable, battle-tested GIF encoder, [use gifski](https://gif.ski/).

## License

MIT
