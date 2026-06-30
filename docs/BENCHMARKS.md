# Benchmark Results

25 fixtures × 4 resolutions × 8 encoders. Quality metrics via ffmpeg libvmaf and dssim.
All results reproducible: `npx tsx test/bench/run-sample.ts --keep-gifs`

## gifhero vs gifski

### balanced preset (default) — optimized for file size

| Resolution | Size wins | Total size | vs gifski | Avg VMAF Δ |
|-----------|-----------|-----------|-----------|------------|
| **480p** | 22/25 | 55.6 MB | **-14%** | +0.1 |
| **360p** | 23/25 | 32.7 MB | **-14%** | +0.3 |
| **240p** | 24/25 | 15.8 MB | **-14%** | +1.3 |
| **160p** | 24/25 | 7.9 MB | **-14%** | +2.0 |

### quality preset — optimized for VMAF

| Resolution | VMAF wins | Total size | vs gifski | Avg VMAF Δ |
|-----------|-----------|-----------|-----------|------------|
| **480p** | 15/25 | 59.8 MB | **-7%** | +0.5 |
| **360p** | 18/25 | 36.2 MB | **-5%** | +1.0 |
| **240p** | 22/25 | 17.6 MB | **-4%** | +2.2 |
| **160p** | 21/25 | 8.8 MB | **-4%** | +3.0 |

Zero VMAF losses >2 points on either preset.

---

## All encoders (25 fixtures, 480p)

| Encoder | Total size | Avg VMAF | Avg SSIM | Avg DSSIM | vs gifhero |
|---------|-----------|----------|----------|-----------|------------|
| **gifhero balanced** | **55.6 MB** | **96.5** | **0.9726** | **0.0018** | — |
| gifhero quality | 59.8 MB | 96.9 | 0.9754 | 0.0014 | +8% |
| gifski (q90) | 64.4 MB | 96.3 | 0.9729 | 0.0031 | +16% |
| gifski-lossy (q80/lq80) | 51.5 MB | 94.4 | 0.9630 | 0.0047 | -7% |
| ffmpeg (palettegen) | 102.0 MB | 97.6 | 0.9660 | 0.0009 | +83% |
| ffmpeg-hq (per-frame) | 146.8 MB | 95.7 | 0.9610 | 0.0175 | +164% |
| ImageMagick | 137.5 MB | 98.0 | 0.9544 | 0.0025 | +147% |
| ffmpeg + gifsicle | 84.4 MB | 97.1 | 0.9584 | 0.0030 | +52% |

gifski-lossy is the only encoder that produces smaller files than gifhero, but at a 2-point VMAF cost — visible quality degradation. ffmpeg and ImageMagick achieve slightly higher VMAF but at 2-3× the file size.

---

## Per-fixture results (balanced vs gifski, 480p)

| Fixture | gifhero | gifski | Size Δ | VMAF Δ | Type |
|---------|---------|--------|--------|--------|------|
| screencast | 15 KB | 50 KB | **-69%** | 0.0 | UI recording |
| bbb-clip-01 | 3,105 KB | 4,775 KB | **-35%** | -1.4 | Animation |
| bbb-clip-04 | 1,372 KB | 2,102 KB | **-35%** | -1.1 | Animation |
| big-buck-bunny | 2,194 KB | 3,172 KB | **-31%** | +0.0 | Animation |
| bbb-clip-05 | 1,565 KB | 2,269 KB | **-31%** | -1.2 | Nature |
| skin-tones | 133 KB | 180 KB | **-26%** | +0.1 | Portrait |
| bbb-clip-09 | 1,302 KB | 1,730 KB | **-25%** | -0.5 | Mixed |
| city-night | 3,251 KB | 4,182 KB | **-22%** | -0.3 | Urban |
| bbb-clip-02 | 2,746 KB | 3,806 KB | **-28%** | -1.2 | Animation |
| bbb-clip-06 | 1,141 KB | 1,473 KB | **-23%** | +0.4 | Animation |
| bbb-clip-07 | 2,036 KB | 2,661 KB | **-23%** | +4.3 | Animation |
| sintel | 1,260 KB | 1,457 KB | **-13%** | +0.1 | Film |
| jellyfish | 2,640 KB | 2,939 KB | **-10%** | -0.8 | Nature |
| bbb-clip-10 | 3,869 KB | 4,451 KB | **-13%** | 0.0 | Animation |
| talking-head | 1,121 KB | 1,223 KB | **-8%** | -0.2 | Webcam |
| shapes | 344 KB | 398 KB | **-14%** | +3.0 | Synthetic |
| color-wheel | 4,046 KB | 4,304 KB | **-6%** | -0.3 | Gradient |
| black-and-white | 12,040 KB | 12,367 KB | **-3%** | 0.0 | High contrast |
| pixel-art | 329 KB | 361 KB | **-9%** | +0.1 | Pixel art |
| screen-recording | 689 KB | 719 KB | **-4%** | +0.1 | Screen |
| bbb-clip-03 | 996 KB | 1,358 KB | **-27%** | -1.1 | Animation |
| candle-flame | 227 KB | 219 KB | +4% | +0.6 | Low light |
| fast-action | 3,836 KB | 3,282 KB | +17% | **+3.2** | Sports |
| bbb-clip-08 | 6,653 KB | 6,514 KB | +2% | +0.1 | Animation |

22/25 fixtures are smaller. On the 3 where gifski is smaller, gifhero has higher VMAF (+3.2 on fast-action, +0.6 on candle-flame, +0.1 on bbb-clip-08).

---

## Encode speed

### Per-encoder timing (25 fixtures, 480p)

| Encoder | Avg time | Relative |
|---------|----------|----------|
| gifski-lossy | 282 ms | 1.0× |
| gifski | 333 ms | 1.2× |
| ffmpeg | 700 ms | 2.5× |
| ffmpeg-hq | 1,900 ms | 6.7× |
| **gifhero balanced** | **2,726 ms** | **9.7×** |
| gifhero quality | 2,835 ms | 10.1× |
| ImageMagick | 3,176 ms | 11.3× |
| ffmpeg + gifsicle | 3,876 ms | 13.8× |

Timings from the Node.js benchmark (TS + WASM). The native Rust CLI is ~3× faster.

### Native CLI

| | Time (100 frames, 480p) |
|---|---|
| gifhero CLI (Rust) | ~0.9s |
| gifski CLI | ~0.3s |

gifski is ~3× faster per file because it parallelizes quantization across frames. gifhero can't — the sub-frame pipeline requires sequential canvas tracking (each frame's transparency depends on the previous decoded frame). This sequential dependency is the cost of 14% smaller files.

### Batch throughput (Rust CLI)

| Concurrent files | Threads/file | Throughput | Speedup |
|-----------------|-------------|------------|---------|
| 1 | 16 | 1.5 files/s | 2.3× |
| 2 | 8 | 2.4 files/s | 3.6× |
| **4** | **4** | **3.4 files/s** | **5.2×** |
| 8 | 2 | 1.9 files/s | 2.9× |

Sweet spot: 4 concurrent files on 16 cores.

---

## Why gifhero produces smaller files

GIF structural analysis:

| | gifhero | gifski | ffmpeg | ImageMagick |
|---|---|---|---|---|
| Bits per pixel | 1.52 | 1.79 | 2.83 | 4.01 |
| Sub-frame usage | 42% | 40% | 32% | 9% |
| Avg palette size | 188 | 244 | global | 226 |
| Transparency | 84% | 97% | 97% | 58% |

Five techniques drive the difference:

1. **Static pixel detection** — pixels that never change become unconditionally transparent
2. **Canvas-aware quantization** — imagequant's `set_background` blends dithering with the previous decoded frame, so transparency boundaries are invisible
3. **Power-of-2 palette targeting** — unused entries are evicted to cross bit boundaries, reducing LZW minimum code size
4. **Content-adaptive thresholds** — motion level and color complexity drive per-frame transparency and compression
5. **Lossy LZW with deferred clear** — Chebyshev distance matching for approximate dictionary lookups; dictionary clear deferred until compression ratio degrades

---

## Notable results

### Biggest VMAF wins (quality preset vs gifski)

| Fixture | Resolution | VMAF Δ | Size Δ |
|---------|-----------|--------|--------|
| fast-action | 160p | **+12.5** | +28% |
| bbb-clip-07 | 160p | **+10.2** | -13% |
| black-and-white | 160p | **+9.5** | +12% |
| fast-action | 240p | **+9.1** | +25% |
| bbb-clip-07 | 240p | **+8.5** | -16% |

### Biggest size wins (balanced preset)

| Fixture | Resolution | Size Δ | VMAF Δ |
|---------|-----------|--------|--------|
| screencast | 240p | **-77%** | +0.1 |
| screencast | 160p | **-73%** | -1.4 |
| screencast | 480p | **-69%** | 0.0 |
| screencast | 360p | **-69%** | +0.5 |
| skin-tones | 160p | **-52%** | -0.9 |

---

## Methodology

- **25 fixtures**: Big Buck Bunny clips (10), Sintel, screencasts, talking heads, fast action, jellyfish, gradients, pixel art, skin tones, solid colors, candle flame
- **4 resolutions**: native 480p, 360p, 240p, 160p
- **8 encoders**: gifhero balanced, gifhero quality, gifski (q90), gifski-lossy (q80/lq80), ffmpeg (palettegen + Floyd-Steinberg), ffmpeg-hq (per-frame palette), ImageMagick (OptimizePlus + OptimizeTransparency), ffmpeg + gifsicle (-O3 --lossy=80)

### Quality metrics

| Metric | Source | Measures |
|--------|--------|----------|
| VMAF | ffmpeg libvmaf | Perceptual quality (0-100, higher = better) |
| SSIM | ffmpeg | Structural similarity (0-1, higher = better) |
| DSSIM | dssim CLI | Per-frame structural dissimilarity (lower = better) |
| PSNR | ffmpeg | Peak signal-to-noise ratio |
| CIEDE2000 | ffmpeg libvmaf | Perceptual color accuracy (lower = better) |
| CAMBI | ffmpeg libvmaf | Banding artifacts (lower = better) |
| TFS | custom | Temporal flicker score (lower = better) |

### Running benchmarks

```bash
# Quick run (subset of fixtures)
npx tsx test/bench/run-sample.ts --fixtures bbb-clip-01,screencast --encoders gifhero-balanced,gifski

# Full suite
npx tsx test/bench/run-sample.ts --resolutions 0,360,240,160

# List available fixtures and encoders
npx tsx test/bench/run-sample.ts --list

# Interactive HTML report
open test/bench/report.html
```

### Full per-resolution tables

See [test/bench/REPORT.md](../test/bench/REPORT.md) for per-fixture results at all 4 resolutions with both presets.
