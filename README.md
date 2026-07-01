# gifhero

A GIF encoder built in two weeks with [Claude Code](https://claude.ai/code), to see how close we could get to [gifski](https://gif.ski/).

## How it went

[gifski](https://gif.ski/) by [Kornel Lesiński](https://kornel.ski/) is the best GIF encoder out there. We wanted to know: with modern tooling and a different approach to sub-frame optimization, could we do better on file size without losing quality?

The answer: a little. gifhero produces **4-17% smaller files** (depending on resolution) with slightly higher VMAF (+0.7). But gifski is **4x faster**, because it parallelizes quantization across frames. gifhero can't do that. Its sub-frame pipeline needs the decoded canvas from each previous frame to decide which pixels to make transparent, so frames must be processed in order.

<p align="center">
  <img src="docs/benchmark-chart.png" alt="gifhero vs gifski and other encoders: file size and VMAF quality comparison across 25 fixtures">
</p>

The size savings come from a few techniques gifski doesn't use: texture-aware stale pixel detection, edge sparse suppression to shrink bounding boxes, palette fitness reuse to avoid requantizing when the palette still fits, and a direction-aware forward-look to prevent ghost accumulation in smooth areas. None of these are free. They all require sequential processing, which is why gifhero is slower.

For most people, gifski is the right choice. It's fast, it's mature, and the quality is excellent. gifhero is interesting if you care more about file size than encoding speed, or if you want to encode GIFs in the browser.

## What's in here

- TypeScript browser SDK with a fluent API and WASM encoding
- Rust CLI with Rayon parallelism
- Custom libimagequant WASM module with `set_background` support
- Benchmark suite: 6 encoders, 25 fixtures, 4 resolutions, VMAF/SSIM/PSNR metrics
- Full pipeline parity between the Rust CLI and the TypeScript SDK

Built entirely with Claude Code over about two weeks.

## Benchmark results

25 fixtures, 4 resolutions, default settings for both encoders. Full results in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

### gifhero vs gifski

| Resolution | Size wins | VMAF wins | Avg size delta | Avg VMAF delta |
|-----------|-----------|-----------|------------|------------|
| **480p** | **17/25** | **21/25** | **-4%** | **+1.4** |
| **360p** | **21/25** | 17/25 | **-10%** | **+0.9** |
| **240p** | **22/25** | 19/25 | **-13%** | **+1.2** |
| **160p** | **24/25** | 17/25 | **-17%** | **+1.3** |

### Speed

| | Per file (100 frames, 720p to 480p) |
|---|---|
| gifski CLI | **~0.3s** |
| gifhero CLI (Rust) | ~1.3s |
| gifhero SDK (Node.js) | ~14s |

gifski wins on speed by a wide margin.

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

### CLI

```bash
brew install Gabe-LS/tap/gifhero
```

Or build from source:
```bash
cd packages/gifhero-core
cargo build --release --features cli
```

```bash
gifhero input.mp4 -w 480 --fps 20 -o output.gif
gifhero video1.mp4 video2.mp4 video3.mp4 -w 480 -o outdir/
```

Requires ffmpeg on PATH.

## How it works

Two passes: **probe**, then **encode**.

The probe pass scans all frames in under 100ms. It builds a per-pixel static mask (which pixels never change), measures motion level and color complexity, computes gradient density, and detects scene changes.

The encode pass uses those results to drive everything. It builds a shared palette at keyframes and remaps subsequent frames against it until the palette drifts too far (measured by p95 nearest-color distance). For each non-keyframe, it computes a texture variance map, uses it to scale the stale-pixel threshold per pixel (smooth areas get tighter thresholds to prevent ghosting), checks whether the pixel is drifting in the same direction next frame, then hands the alpha-zeroed frame to imagequant with the previous canvas as background. After quantization, it suppresses isolated near-stale pixels at bounding box edges to shrink the crop rectangle, trims the palette to a power-of-2 boundary when possible (saves a bit in LZW), and composites onto the canvas for the next frame.

## Architecture

```
Browser SDK:
  VideoDecoder, Mediabunny demux, frame extraction
  JS orchestrator, WASM FrameEncoder (transparency + quantize + subframe)
  WASM Lanczos3, JS LZW, GIF

CLI (Rust):
  ffmpeg, raw RGBA frames
  Rayon parallel Lanczos3, sequential quantize + sub-frame
  Rayon parallel LZW, GIF
```

## Development

```bash
npm run build        # Build TypeScript bundles
npm run test         # Run vitest (52 tests)
npm run bench        # Sequential encoding (accurate timing) + parallel metrics
npm run bench:fast   # 6 fixtures, gifhero + gifski only
npm run bench:parallel  # Full parallelism, no timing capture

# Rust CLI
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

## Acknowledgments

This project owes everything to [gifski](https://gif.ski/) and [Kornel Lesiński](https://kornel.ski/). The idea of passing the decoded canvas as a background to libimagequant so that dithering blends seamlessly at transparency boundaries is his. gifhero uses the same library and the same core approach. The sub-frame tricks on top are incremental. If you need a GIF encoder that's fast, reliable, and proven in production, [use gifski](https://gif.ski/).

## License

MIT
