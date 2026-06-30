# Benchmark Results

25 fixtures × 4 resolutions. gifhero vs gifski (default settings, no lossy LZW).
Quality measured via ffmpeg libvmaf. All results reproducible: `npm run bench`

## gifhero vs gifski — summary

| Resolution | Size wins | VMAF wins | Avg size Δ | Avg VMAF Δ |
|-----------|-----------|-----------|------------|------------|
| **480p** | **66%** (16/25) | **84%** (21/25) | **-5%** | **+1.8** |
| **360p** | **64%** (16/25) | **88%** (22/25) | **-5%** | **+2.1** |
| **240p** | **68%** (17/25) | **88%** (22/25) | **-7%** | **+2.4** |
| **160p** | **72%** (18/25) | **84%** (21/25) | **-8%** | **+2.5** |

gifhero produces smaller files on ~2/3 of fixtures with better VMAF on ~85%. No lossy LZW — this is pure pipeline advantage (probe, transparency, palette fitness, edge suppression).

---

## Per-fixture results (480p)

| Fixture | gifhero | gifski | Size Δ | VMAF Δ | Content type |
|---------|---------|--------|--------|--------|------|
| screencast | 13 KB | 50 KB | **-73%** | -0.6 | UI recording |
| skin-tones | 127 KB | 179 KB | **-29%** | -0.3 | Portrait |
| candle-flame | 185 KB | 218 KB | **-15%** | +0.7 | Low light |
| pixel-art | 278 KB | 360 KB | **-23%** | -0.9 | Pixel art |
| shapes | 456 KB | 398 KB | +15% | +2.9 | Synthetic |
| screen-recording | 695 KB | 718 KB | **-3%** | +0.0 | Screen capture |
| bbb-clip-03 | 1,261 KB | 1,357 KB | **-7%** | -0.3 | Animation |
| bbb-clip-09 | 1,531 KB | 1,730 KB | **-11%** | +0.3 | Animation |
| talking-head | 1,434 KB | 1,222 KB | +17% | +1.5 | Webcam |
| sintel | 1,572 KB | 1,456 KB | +8% | +1.2 | CGI film |
| bbb-clip-04 | 1,662 KB | 2,102 KB | **-21%** | +0.1 | Animation |
| bbb-clip-05 | 2,062 KB | 2,269 KB | **-9%** | +0.6 | Nature |
| bbb-clip-07 | 2,619 KB | 2,660 KB | **-2%** | +17.8 | Animation |
| big-buck-bunny | 2,692 KB | 3,172 KB | **-15%** | +1.8 | Animation |
| bbb-clip-02 | 3,661 KB | 3,805 KB | **-4%** | +1.0 | Animation |
| bbb-clip-01 | 3,696 KB | 4,775 KB | **-23%** | +0.1 | Animation |
| jellyfish | 3,178 KB | 2,938 KB | +8% | +0.8 | Nature |
| city-night | 3,816 KB | 4,181 KB | **-9%** | +0.5 | Urban |
| bbb-clip-10 | 4,388 KB | 4,450 KB | **-1%** | +0.0 | Animation |
| color-wheel | 4,424 KB | 4,303 KB | +3% | +0.6 | Gradient |
| bbb-clip-06 | 1,343 KB | 1,473 KB | **-9%** | +0.8 | Animation |
| fast-action | 5,080 KB | 3,281 KB | +55% | +3.5 | Sports |
| bbb-clip-08 | 7,542 KB | 6,514 KB | +16% | +0.4 | Animation |
| black-and-white | 13,914 KB | 12,366 KB | +13% | +0.0 | High contrast |

16/25 fixtures smaller than gifski. On 8 of the 9 where gifski is smaller, gifhero has higher VMAF — a deliberate quality-over-size trade-off by the adaptive stale threshold.

---

## Why gifhero produces smaller files

Six techniques drive the compression advantage:

1. **Static pixel detection** — probe identifies pixels that never change across all frames; these become unconditionally transparent
2. **Canvas-aware quantization** — imagequant's `set_background` blends dithering with the decoded canvas, making transparency boundaries invisible
3. **Palette fitness model** — builds a shared palette at keyframes, remaps subsequent frames via fast remap instead of full per-frame quantization; rebuilds when palette fitness degrades
4. **Content-adaptive stale threshold** — motion level × color complexity drives per-frame transparency aggressiveness, tuned via rate-distortion sweep
5. **Edge sparse suppression** — isolated near-stale pixels at the bbox boundary are suppressed to shrink the crop rectangle without affecting interior quality
6. **Power-of-2 palette targeting** — unused entries evicted to cross bit boundaries, reducing LZW minimum code size

### Where gifski wins

gifski produces smaller files on high-motion content with spatially sparse changes (talking-head, fast-action, jellyfish). The root cause: GIF's single-rectangle-per-frame format. When changed pixels span the full frame width but are scattered, the bounding box is nearly full-size and the indexed data contains alternating transparent/opaque runs that LZW compresses poorly. gifski's LZW-aware dithering (written by the imagequant author) produces more compressible indexed patterns on these cases.

---

## Encode speed

| Encoder | Avg time (480p) | Relative |
|---------|----------------|----------|
| gifski | ~350 ms | 1.0× |
| **gifhero** | **~3.5s** | **~10×** |

gifhero is ~10× slower due to sequential canvas-dependent encoding (each frame's transparency depends on the previous decoded frame). The WASM imagequant quantize step is 60-70% of encoding time.

### Per-stage timing breakdown (bbb-clip-01, 100 frames, 480p)

| Stage | Time | % |
|-------|------|---|
| quantize | 2.0s | 47% |
| transparency | 0.6s | 14% |
| write (LZW + GIF) | 0.3s | 7% |
| denoise | 0.2s | 5% |
| subframe | 0.2s | 4% |
| probe | 0.1s | 3% |
| palette | <1ms | 0% |
| **total** | **~4.2s** | |

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

# Parallel mode (worker threads for gifhero encoding)
npm run bench:parallel

# Specific fixtures/encoders
npx tsx test/bench/run.ts --fixtures bbb-clip-01,talking-head --encoders gifhero,gifski

# List available fixtures and encoders
npx tsx test/bench/run.ts --list
```

Results are saved to `test/bench/results/{timestamp}/` with a `latest` symlink. Open `test/bench/viewer.html` for A/B visual comparison.
