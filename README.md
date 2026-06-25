# gifhero

High-quality GIF encoder. Browser SDK + native CLI.

Produces 4-15% smaller files than gifski at equal or better perceptual quality (VMAF), validated across 25 fixtures at 4 resolutions.

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

Requires ffmpeg on PATH.

## Performance

### vs gifski (25 fixtures, native 480p)

**balanced preset** — optimized for file size:

| Resolution | Size wins | Total size delta | Avg VMAF delta |
|-----------|-----------|-----------------|----------------|
| 480p | 22/25 | **-14%** | 0.0 |
| 360p | 23/25 | **-15%** | 0.0 |
| 240p | 24/25 | **-14%** | 0.0 |
| 160p | 24/25 | **-15%** | 0.0 |

**quality preset** — optimized for VMAF:

| Resolution | Size wins | Total size delta | Avg VMAF delta |
|-----------|-----------|-----------------|----------------|
| 480p | 16/25 | **-7%** | **+0.3** |
| 360p | 19/25 | **-6%** | 0.0 |
| 240p | 18/25 | **-4%** | 0.0 |
| 160p | 19/25 | **-5%** | 0.0 |

### Encode speed

| Target | Time (100 frames, 480p) |
|--------|------------------------|
| gifhero CLI (Rust + Rayon) | 0.9s |
| gifhero browser (TS + WASM) | ~3s |
| gifski CLI | 0.35s |

Batch throughput: 3.4 files/s at 4-wide concurrency on 16 cores.

## How it works

Two-pass pipeline: **probe** then **encode**.

1. **Probe**: scans all frames for static pixels, motion level, color complexity, scene changes
2. **Denoise**: temporal median filter (balanced preset only)
3. **Downscale**: WASM Lanczos3 (12x faster than JS)
4. **Shared palette**: multi-frame histogram when color complexity is high
5. **Per-frame encode**: imagequant with `set_background` for native transparency, importance maps for static pixels
6. **Sub-frame optimization**: tight bounding box, palette trimming with power-of-2 targeting
7. **Lossy LZW**: Chebyshev distance matching with deferred clear codes

The sub-frame optimization is why gifhero produces smaller files than gifski — unchanged pixels become transparent, reducing LZW entropy. This requires sequential canvas tracking (each frame depends on the previous), which is why per-file encode speed is 2.5x slower than gifski's parallel quantization.

## Presets

| | quality | balanced |
|---|---|---|
| imagequant quality | 98 | 95 |
| staleThreshold | 4 (adaptive) | 5 (adaptive) |
| Temporal denoise | No | Yes |
| Per-frame boost | No | +1 on near-static |
| maxColors | 224 at high complexity | 192 at high complexity |

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
  -o, --output <OUTPUT>    Output path (file or directory)
  -w, --width <WIDTH>      Target width (height auto)
      --height <HEIGHT>    Target height
      --fps <FPS>          Frames per second [default: 20]
      --preset <PRESET>    quality | balanced [default: balanced]
      --max-duration <S>   Maximum duration in seconds
  -j, --threads <N>        Threads per file [default: auto]
  -q, --quiet              Suppress output
```

## Development

```bash
npm run build        # Build TypeScript bundles
npm run test         # Run vitest (52 tests)
npm run bench        # Full benchmark (25 fixtures x 4 resolutions x 5 encoders)

# Rust CLI
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

## License

MIT
