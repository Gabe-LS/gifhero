# gifhero — Testing & Benchmarking

## Running Tests

```bash
npm run test          # vitest (52 tests)
npm run test:quality  # quality gate tests
```

## Benchmarking

### Quick comparison

```bash
# 10 fixtures, gifhero vs gifski, 480p
npx tsx test/bench/run.ts \
  --fixtures bbb-clip-01,bbb-clip-05,big-buck-bunny,candle-flame,city-night,color-wheel,jellyfish,screen-recording,skin-tones,talking-head \
  --encoders gifhero,gifski --resolutions 480 --metrics vmaf
```

### Full benchmark

```bash
npm run bench           # 25 fixtures × 4 resolutions (480p, 360p, 240p, 160p)
npm run bench:fast      # 6 fixtures, gifhero + gifski only
npm run bench:parallel  # worker threads for gifhero encoding
```

### CLI options

```
npx tsx test/bench/run.ts [options]

  --fixtures <names>      Comma-separated fixture names [default: all 25]
  --resolutions <widths>  Comma-separated target widths [default: 480,360,240,160]
  --encoders <names>      Comma-separated encoder names [default: all]
  --metrics <names>       Comma-separated: vmaf,ssim,psnr,ciede,cambi,dssim,tfs [default: all]
  --out-dir <path>        Base output directory [default: test/bench/results]
  --list                  List available fixtures and encoders
  --parallel              Encode gifhero via worker threads
  --fast                  6 fixtures, gifhero+gifski, skip DSSIM/TFS
```

### Output structure

Each run produces a timestamped directory:

```
test/bench/results/
  2026-06-30-1950/
    results.json          # all metrics + GIF structural analysis + timing
    gifs/
      bbb-clip-01-480p-gifhero.gif
      bbb-clip-01-480p-gifski.gif
      ...
  latest -> 2026-06-30-1950/
```

### Visual comparison

```bash
# Start local server
cd test/bench && python3 -m http.server 8765

# Open viewer (loads results/latest/)
open http://localhost:8765/viewer.html
```

Keyboard shortcuts: Space pause, Left/Right step frames, Up/Down cycle encoders, Fn+Up/Down cycle fixtures, L toggle loupe.

## Encoders

| Encoder | Description |
|---------|-------------|
| `gifhero` | balanced preset, lossyLzw=0 |
| `gifski` | gifski CLI, default quality (90) |
| `ffmpeg` | global palette, floyd_steinberg dither |
| `ffmpeg-hq` | per-frame palette |
| `magick` | ImageMagick OptimizePlus + OptimizeTransparency |
| `ffmpeg+gifsicle` | ffmpeg global palette + gifsicle -O3 --lossy=80 |

## Quality metrics

| Metric | Source | Measures |
|--------|--------|----------|
| VMAF | ffmpeg libvmaf | Perceptual quality (0-100, higher=better) |
| DSSIM | dssim CLI | Per-frame structural dissimilarity (lower=better) |
| SSIM | ffmpeg | Structural similarity |
| PSNR | ffmpeg | Peak signal-to-noise ratio |

## Per-stage timing

The JSON output includes per-stage timing for gifhero results:

```json
{
  "timing": {
    "downscale": 0,
    "denoise": 200,
    "probe": 150,
    "palette": 2,
    "transparency": 600,
    "quantize": 2000,
    "subframe": 130,
    "write": 330,
    "_staleThreshold": 8
  }
}
```

Hover over the Time cell in the viewer to see the breakdown as a tooltip.

## Test fixtures

25 fixtures covering animation, screencasts, webcam, sports, gradients, pixel art, low light, and synthetic content. All at 480p (20fps), 60-100 frames per fixture.

```bash
npx tsx test/bench/run.ts --list   # show all fixtures with frame counts
```

## Prerequisites

```bash
brew install gifski gifsicle ffmpeg dssim
npm run bench:setup   # download and extract test fixtures
```
