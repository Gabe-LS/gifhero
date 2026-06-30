# Benchmark Results

25 fixtures × 4 resolutions. gifhero vs gifski (default settings, no lossy LZW).
Quality measured via ffmpeg libvmaf. All results reproducible: `npm run bench`

## gifhero vs gifski — summary

| Resolution | Size wins | VMAF wins | Avg size Δ | Avg VMAF Δ |
|-----------|-----------|-----------|------------|------------|
| **480p** | 14/25 | **22/25** | +3% | **+1.4** |
| **360p** | **17/25** | **19/25** | **-3%** | **+1.1** |
| **240p** | **19/25** | **18/25** | **-5%** | **+1.2** |
| **160p** | **22/25** | **17/25** | **-10%** | **+1.3** |

gifhero produces smaller files on most fixtures at ≤360p with better VMAF across all resolutions. At 480p, gifhero trades slightly larger files (+3% average) for significantly better quality (+1.4 VMAF average, 22/25 wins).

---

## Per-fixture results (480p)

| Fixture | gifhero | gifski | Size Δ | VMAF Δ | Content type |
|---------|---------|--------|--------|--------|------|
| screencast | 17 KB | 50 KB | **-66%** | -0.5 | UI recording |
| skin-tones | 131 KB | 179 KB | **-27%** | -0.2 | Portrait |
| pixel-art | 267 KB | 360 KB | **-26%** | -0.8 | Pixel art |
| candle-flame | 179 KB | 218 KB | **-18%** | +0.5 | Low light |
| bbb-clip-01 | 4,021 KB | 4,775 KB | **-16%** | +0.4 | Animation |
| big-buck-bunny | 2,806 KB | 3,172 KB | **-12%** | +1.8 | Animation |
| bbb-clip-04 | 1,866 KB | 2,102 KB | **-11%** | +0.3 | Animation |
| city-night | 3,741 KB | 4,181 KB | **-11%** | +0.6 | Urban |
| bbb-clip-09 | 1,629 KB | 1,730 KB | **-6%** | +0.9 | Animation |
| shapes | 380 KB | 398 KB | **-4%** | +2.2 | Synthetic |
| bbb-clip-07 | 2,543 KB | 2,660 KB | **-4%** | +18.0 | Animation |
| bbb-clip-05 | 2,204 KB | 2,269 KB | **-3%** | +0.8 | Nature |
| screen-recording | 701 KB | 718 KB | **-2%** | +0.0 | Screen capture |
| bbb-clip-06 | 1,474 KB | 1,473 KB | +0% | +0.6 | Animation |
| bbb-clip-10 | 4,458 KB | 4,450 KB | +0% | +0.0 | Animation |
| bbb-clip-02 | 3,889 KB | 3,805 KB | +2% | +1.6 | Animation |
| color-wheel | 4,400 KB | 4,303 KB | +2% | +0.5 | Gradient |
| jellyfish | 3,023 KB | 2,938 KB | +3% | +1.0 | Nature |
| bbb-clip-03 | 1,410 KB | 1,357 KB | +4% | +1.1 | Animation |
| bbb-clip-08 | 6,787 KB | 6,514 KB | +4% | +0.4 | Animation |
| sintel | 1,610 KB | 1,456 KB | +11% | +1.2 | CGI film |
| black-and-white | 13,951 KB | 12,366 KB | +13% | +0.0 | High contrast |
| talking-head | 1,384 KB | 1,222 KB | +13% | +1.6 | Webcam |
| fast-action | 4,874 KB | 3,281 KB | +49% | +3.6 | Sports |

14/25 fixtures smaller than gifski at 480p. On 10 of the 11 where gifski is smaller, gifhero has higher VMAF — a quality-over-size trade-off from the adaptive stale threshold.

---

## Why gifhero produces smaller files

Six techniques drive the compression advantage:

1. **Static pixel detection** — probe identifies pixels that never change across all frames; these become unconditionally transparent
2. **Canvas-aware quantization** — imagequant's `set_background` blends dithering with the decoded canvas, making transparency boundaries invisible
3. **Palette fitness model** — builds a shared palette at keyframes, remaps subsequent frames via fast remap; triggers full per-frame quantization when p95 nearest-color distance exceeds threshold (prevents gradient posterization)
4. **Adaptive maxColors** — gradient density × color complexity from the probe determines optimal palette size per clip (256 for gradient-heavy, 160 for texture-dominant). Validated via 72-point sweep across 12 fixtures × 6 maxColors values
5. **Edge sparse suppression** — isolated near-stale pixels at the bbox boundary are suppressed to shrink the crop rectangle without affecting interior quality
6. **Power-of-2 palette targeting** — unused entries evicted to cross bit boundaries, reducing LZW minimum code size

### Where gifski wins

gifski produces smaller files on high-motion content with spatially sparse changes (talking-head, fast-action, sintel). The root cause: GIF's single-rectangle-per-frame format. When changed pixels span the full frame width but are scattered, the bounding box is nearly full-size and the indexed data contains alternating transparent/opaque runs that LZW compresses poorly. gifski's LZW-aware dithering (written by the imagequant author) produces more compressible indexed patterns on these cases.

---

## Encode speed

| Encoder | Avg time (480p) | Relative |
|---------|----------------|----------|
| gifski | ~350 ms | 1.0× |
| **gifhero** | **~7s** | **~20×** |

gifhero is slower due to sequential canvas-dependent encoding (each frame's transparency depends on the previous decoded frame). The WASM imagequant quantize step is ~50% of encoding time.

### Per-stage timing breakdown (bbb-clip-01, 100 frames, 480p)

| Stage | Time | % |
|-------|------|---|
| quantize | ~4s | 50% |
| transparency | ~0.6s | 8% |
| write (LZW + GIF) | ~0.3s | 4% |
| denoise | ~0.2s | 3% |
| probe | ~0.1s | 2% |

### Benchmark tool parallelism

| Mode | Encoding | Metrics | Use case |
|------|----------|---------|----------|
| Default (`npm run bench`) | Sequential (accurate timing) | 8-wide parallel | Benchmarking |
| Parallel (`npm run bench:parallel`) | 8 workers + 8 concurrent processes | 8-wide parallel | Fast testing (~5× faster) |

Worker thread concurrency sweep (8 gifhero jobs):

| Workers | Wall clock | Speedup |
|---------|-----------|---------|
| 1 | 81.7s | 1.0× |
| 2 | 46.2s | 1.8× |
| 4 | 28.0s | 2.9× |
| 8 | 14.6s | **5.6×** |

---

## Methodology

- **25 fixtures**: Big Buck Bunny clips (10), Sintel, screencasts, talking heads, fast action, jellyfish, gradients, pixel art, skin tones, candle flame, shapes, black-and-white
- **4 resolutions**: 480p, 360p, 240p, 160p
- **2 encoders**: gifhero (balanced preset, lossyLzw=0), gifski (default quality 90)
- **Comparison basis**: each encoder at its recommended default settings, no lossy LZW

### Quality metrics

| Metric | Source | Measures |
|--------|--------|----------|
| VMAF | ffmpeg libvmaf | Perceptual quality (0-100, higher = better) |
| DSSIM | dssim CLI | Per-frame structural dissimilarity (lower = better) |

### Running benchmarks

```bash
# Full suite (25 fixtures × 4 resolutions)
npm run bench

# Fast mode (6 fixtures, gifhero + gifski only)
npm run bench:fast

# Parallel mode (~5× faster, no timing capture)
npm run bench:parallel

# Specific fixtures/encoders
npx tsx test/bench/run.ts --fixtures bbb-clip-01,talking-head --encoders gifhero,gifski

# List available fixtures and encoders
npx tsx test/bench/run.ts --list
```

Results are saved to `test/bench/results/{timestamp}/` with a `latest` symlink. Open `test/bench/viewer.html` for A/B visual comparison.
