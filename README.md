# gifhero

The best in-browser GIF encoder. **21% smaller files** than gifski-wasm on every fixture tested, at comparable quality and speed.

<p align="center">
  <img src="docs/benchmark-chart.png" alt="gifhero vs gifski-wasm: 21% smaller files on all 25 fixtures at comparable quality">
</p>

## Why

There was no good way to encode GIFs in the browser. [gifski](https://gif.ski/) by [Kornel Lesiński](https://kornel.ski/) is the best GIF encoder, but it was designed as a CLI tool. Its WASM port ([gifski-wasm](https://www.npmjs.com/package/gifski-wasm)) works in the browser but can't use its main advantage: parallel quantization across threads. In the browser, both encoders run single-threaded WASM on equal footing.

gifhero was built for this environment. It uses a sub-frame transparency pipeline (texture-aware thresholding, palette fitness reuse, edge sparse suppression) that trades encoding parallelism for smaller output. In the browser, where parallelism isn't available anyway, this is a free win.

Built with [Claude Code](https://claude.ai/code) over two weeks.

## Browser benchmark

25 fixtures at 480p. Both encoders get the same frames, same resolution, same WASM runtime. Quality measured via VMAF.

### gifhero vs gifski-wasm (in-browser)

| | gifhero | gifski-wasm |
|---|---|---|
| **Size wins** | **25/25** | 0/25 |
| **Avg file size** | **100%** | **127%** (+21% larger) |
| **Avg VMAF** | 96.8 | 96.6 |

gifhero produces smaller files on every single fixture. Quality is comparable (13/25 fixtures gifhero has higher VMAF, 12/25 gifski-wasm).

### vs gifski CLI (native, multi-threaded)

For reference, gifhero also beats the native gifski CLI on most content:

| | Size wins | Avg size delta | VMAF wins |
|---|---|---|---|
| gifhero vs gifski CLI | **17/25** | **-9.4%** | **20/25** |

gifski CLI is much faster (parallel quantization) but produces larger files on most content.

Full per-fixture results in [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

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

In the browser, the entire per-frame pipeline runs in a single WASM call via `FrameEncoder`, keeping canvas state in WASM linear memory across frames.

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
npm run bench        # Benchmark: gifhero vs gifski vs gifski-wasm (sequential, accurate timing)
npm run bench:fast   # Fast: 6 fixtures, gifhero + gifski only

# Browser benchmark
npx tsx test/browser/gifski-server.ts   # Start server
open http://localhost:3333/test/browser/ # Drop a video, compare all encoders

# Rust CLI
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

## Acknowledgments

This project owes everything to [gifski](https://gif.ski/) and [Kornel Lesiński](https://kornel.ski/). The idea of passing the decoded canvas as a background to libimagequant so that dithering blends seamlessly at transparency boundaries is his. gifhero uses the same library and the same core approach. The sub-frame tricks on top are incremental. If you need a fast, reliable, proven GIF encoder for the command line, [use gifski](https://gif.ski/).

## License

MIT
