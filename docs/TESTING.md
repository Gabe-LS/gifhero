# gifhero - Testing and Benchmarking

## Running Tests

```bash
npm run test          # vitest (52 tests)
npm run test:quality  # quality gate tests
```

## Benchmarking

### Quick comparison

```bash
npx tsx test/bench/run.ts \
  --fixtures bbb-clip-01,screen-recording \
  --encoders gifhero-wasm,gifski-wasm --resolutions 480 --metrics vmaf
```

### Full benchmark

```bash
npm run bench           # 25 fixtures, 4 resolutions, all 8 encoders
npm run bench:fast      # 6 fixtures, gifhero-wasm + gifski only
npm run bench:parallel  # worker threads for gifhero-wasm encoding
```

### Browser benchmark

```bash
npx tsx test/browser/gifski-server.ts   # start server
open http://localhost:3333/test/browser/ # drop a video, compare encoders

# Or automated via Playwright
npx tsx test/browser/playwright-bench.ts test/fixtures/videos/big-buck-bunny.mp4
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
  --parallel              Encode gifhero-wasm via worker threads
  --fast                  6 fixtures, gifhero-wasm+gifski, skip DSSIM/TFS
```

### Output structure

Each run produces a timestamped directory:

```
test/bench/results/
  2026-07-01-1908/
    results.json          # all metrics + GIF structural analysis + timing
    gifs/
      bbb-clip-01-480p-gifhero-wasm.gif
      bbb-clip-01-480p-gifski.gif
      bbb-clip-01-480p-gifski-wasm.gif
      ...
  latest -> 2026-07-01-1908/
```

### Visual comparison

```bash
# Via the test server (serves both viewer and benchmark page)
npx tsx test/browser/gifski-server.ts
open http://localhost:3333/docs/viewer/
```

Keyboard shortcuts: Space pause, Left/Right step frames, Up/Down cycle encoders, Fn+Up/Down cycle fixtures, L toggle loupe.

## Encoders

| Encoder | Type | Description |
|---------|------|-------------|
| `gifhero-wasm` | WASM | TS SDK with WASM FrameEncoder. Same pipeline as browser. |
| `gifhero` | Native CLI | Rust CLI with Rayon parallelism. Same algorithm. |
| `gifski-wasm` | WASM | gifski-wasm npm package. No multi-threading. |
| `gifski` | Native CLI | gifski CLI with multi-threaded quantization. |
| `ffmpeg` | Native CLI | palettegen + paletteuse (full stats, Floyd-Steinberg). |
| `ffmpeg-hq` | Native CLI | palettegen per frame (single stats). |
| `ffmpeg+gifsicle` | Native CLI | ffmpeg + gifsicle -O3 --lossy=80. |
| `magick` | Native CLI | ImageMagick Floyd-Steinberg + OptimizePlus. |

## Quality metrics

| Metric | Source | Measures |
|--------|--------|----------|
| VMAF | ffmpeg libvmaf | Perceptual quality (0-100, higher=better) |
| SSIM | ffmpeg | Structural similarity |
| PSNR | ffmpeg | Peak signal-to-noise ratio |
| DSSIM | dssim CLI | Per-frame structural dissimilarity (lower=better) |

## Test fixtures

25 fixtures covering animation, screencasts, webcam, sports, gradients, pixel art, low light, and synthetic content. All source frames at 480p (20fps), 60-100 frames per fixture.

```bash
npx tsx test/bench/run.ts --list   # show all fixtures with frame counts
```

## Prerequisites

```bash
brew install gifski gifsicle ffmpeg dssim
npm run bench:setup   # download and extract test fixtures
```
