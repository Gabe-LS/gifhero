# Benchmark Results

25 fixtures, 4 resolutions, 8 encoders. Quality measured via ffmpeg libvmaf + SSIM.
All results reproducible: `npm run bench`

## gifhero vs gifski-wasm (in-browser comparison)

Both run single-threaded WASM. Same input frames, same runtime.

| Resolution | Size wins | Avg size delta | Avg VMAF (gifhero / gifski-wasm) |
|---|---|---|---|
| **480p** | **25/25** | **-21%** | 97.2 / 96.2 |
| **360p** | **25/25** | **-28%** | 96.5 / 96.0 |
| **240p** | **25/25** | **-28%** | 96.6 / 95.8 |
| **160p** | **25/25** | **-30%** | 96.6 / 95.8 |

gifhero produces smaller files on every fixture at every resolution.

## gifhero vs gifski CLI (native, multi-threaded)

| Resolution | Size wins | Avg size delta | VMAF wins |
|---|---|---|---|
| **480p** | **17/25** | **-10%** | **20/25** |
| **360p** | **21/25** | **-16%** | 16/25 |
| **240p** | **22/25** | **-19%** | 18/25 |
| **160p** | **24/25** | **-23%** | 16/25 |

gifski CLI is faster (parallel quantization) but produces larger files on most content.

---

## Per-fixture results (480p)

| Fixture | gifhero | gifski-wasm | gifski CLI | vs wasm | vs CLI | VMAF (h/w/s) |
|---------|---------|-------------|------------|---------|--------|--------------|
| screencast | 16 KB | 50 KB | 50 KB | -66% | -66% | 96.6 / 97.5 / 97.5 |
| candle-flame | 147 KB | 247 KB | 218 KB | -40% | -32% | 97.0 / 97.2 / 96.7 |
| bbb-clip-10 | 3,773 KB | 6,002 KB | 4,450 KB | -37% | -15% | 100.0 / 100.0 / 100.0 |
| skin-tones | 122 KB | 194 KB | 179 KB | -37% | -32% | 96.8 / 96.9 / 97.1 |
| pixel-art | 254 KB | 394 KB | 360 KB | -35% | -30% | 98.0 / 98.9 / 98.9 |
| black-and-white | 11,797 KB | 17,672 KB | 12,366 KB | -33% | -5% | 99.9 / 99.9 / 99.9 |
| sintel | 1,396 KB | 1,991 KB | 1,456 KB | -30% | -4% | 98.6 / 97.9 / 97.3 |
| bbb-clip-07 | 2,387 KB | 3,354 KB | 2,660 KB | -29% | -10% | 95.9 / 75.3 / 77.4 |
| screen-recording | 622 KB | 823 KB | 718 KB | -24% | -13% | 98.0 / 98.1 / 98.2 |
| shapes | 354 KB | 468 KB | 398 KB | -24% | -11% | 96.1 / 94.1 / 94.0 |
| bbb-clip-01 | 4,021 KB | 5,020 KB | 4,775 KB | -20% | -16% | 94.4 / 94.9 / 94.0 |
| fast-action | 3,869 KB | 4,792 KB | 3,281 KB | -19% | +18% | 99.9 / 98.2 / 96.4 |
| bbb-clip-04 | 1,866 KB | 2,306 KB | 2,102 KB | -19% | -11% | 95.7 / 96.1 / 95.4 |
| big-buck-bunny | 2,806 KB | 3,456 KB | 3,172 KB | -19% | -12% | 93.7 / 93.9 / 91.9 |
| bbb-clip-05 | 2,200 KB | 2,686 KB | 2,269 KB | -18% | -3% | 98.3 / 98.3 / 97.5 |
| city-night | 3,739 KB | 4,454 KB | 4,181 KB | -16% | -11% | 97.7 / 97.6 / 97.2 |
| bbb-clip-06 | 1,476 KB | 1,677 KB | 1,473 KB | -12% | +0% | 95.3 / 95.3 / 94.6 |
| bbb-clip-09 | 1,629 KB | 1,847 KB | 1,730 KB | -12% | -6% | 96.6 / 96.1 / 95.7 |
| bbb-clip-08 | 6,586 KB | 7,341 KB | 6,514 KB | -10% | +1% | 98.8 / 98.8 / 98.4 |
| bbb-clip-03 | 1,410 KB | 1,536 KB | 1,357 KB | -8% | +4% | 95.9 / 95.4 / 94.8 |
| bbb-clip-02 | 3,889 KB | 4,110 KB | 3,805 KB | -5% | +2% | 95.1 / 94.5 / 93.5 |
| two-frame | 0 KB | 0 KB | 0 KB | -5% | -5% | 98.7 / 98.7 / 98.7 |
| talking-head | 1,384 KB | 1,456 KB | 1,222 KB | -5% | +13% | 96.6 / 95.9 / 95.0 |
| jellyfish | 3,018 KB | 3,120 KB | 2,938 KB | -3% | +3% | 98.3 / 97.8 / 97.3 |
| color-wheel | 4,400 KB | 4,536 KB | 4,303 KB | -3% | +2% | 98.5 / 98.5 / 98.0 |

Sorted by size delta vs gifski-wasm. gifhero is smaller on all 25 fixtures vs gifski-wasm. gifhero is smaller on 17/25 vs gifski CLI; on 6 of the 8 where gifski CLI is smaller, gifhero has higher VMAF.

---

## Why gifhero produces smaller files

Six techniques drive the compression advantage:

1. **Static pixel detection**: probe identifies pixels that never change; these become unconditionally transparent
2. **Canvas-aware quantization**: imagequant's `set_background` blends dithering with the decoded canvas, making transparency boundaries invisible
3. **Palette fitness model**: builds a shared palette at keyframes, remaps subsequent frames via fast remap; triggers full quantization when p95 nearest-color distance exceeds 8
4. **Adaptive maxColors**: gradient density x color complexity from the probe determines optimal palette size (256 for gradient-heavy, 160 for texture-dominant)
5. **Edge sparse suppression**: isolated near-stale pixels at bbox edges are suppressed to shrink the crop rectangle
6. **Power-of-2 palette targeting**: unused entries evicted to cross bit boundaries, reducing LZW minimum code size

### Where gifski CLI wins

gifski CLI produces smaller files on high-motion content with spatially sparse changes (talking-head, fast-action). With frequent scene changes, gifhero's sub-frame pipeline has no temporal coherence to exploit. gifski's parallel quantization is better suited to content where every frame is effectively a keyframe.

---

## Encoders

| Encoder | Type | Description |
|---------|------|-------------|
| **gifhero-wasm** | WASM (browser) | gifhero TS SDK with WASM FrameEncoder. Same pipeline as browser. |
| **gifhero** | Native CLI | Rust CLI with Rayon parallelism. Same algorithm as gifhero-wasm. |
| **gifski-wasm** | WASM (browser) | gifski-wasm npm package. Same quantizer, no multi-threading. |
| **gifski** | Native CLI | gifski CLI with multi-threaded quantization. |
| **ffmpeg** | Native CLI | ffmpeg palettegen + paletteuse (full stats, Floyd-Steinberg). |
| **ffmpeg-hq** | Native CLI | ffmpeg palettegen per frame (single stats). |
| **ffmpeg+gifsicle** | Native CLI | ffmpeg + gifsicle -O3 --lossy=80. |
| **magick** | Native CLI | ImageMagick with Floyd-Steinberg + OptimizePlus. |

---

## Methodology

- **25 fixtures**: Big Buck Bunny clips (10), Sintel, screencasts, talking heads, fast action, jellyfish, gradients, pixel art, skin tones, candle flame, shapes, black-and-white
- **4 resolutions**: 480p, 360p, 240p, 160p
- **8 encoders**: all at default settings
- **gifhero**: balanced preset (q90, speed 4, no lossy LZW)
- **gifski CLI**: default quality (q100)
- **gifski-wasm**: quality 90 (matching gifhero)
- **Quality**: VMAF + SSIM via ffmpeg libvmaf

### Running benchmarks

```bash
npm run bench                    # All encoders, sequential (accurate timing)
npm run bench:fast               # 6 fixtures, gifhero + gifski only
npm run bench:parallel           # Full parallelism, no timing

# Custom runs
npx tsx test/bench/run.ts --list
npx tsx test/bench/run.ts --fixtures bbb-clip-01,talking-head
npx tsx test/bench/run.ts --encoders gifhero-wasm,gifski-wasm --metrics vmaf
```

Results saved to `test/bench/results/{timestamp}/` with a `latest` symlink. Open `docs/viewer/index.html` for A/B visual comparison.
