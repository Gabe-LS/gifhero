# gifhero — Testing & Benchmarking Strategy

How to objectively verify that gifhero matches or beats the current best GIF encoders.

---

## The Competitors

Every output from gifhero gets compared against these:

| Tool | Role | Install |
|---|---|---|
| **gifski** | Gold standard quality | `brew install gifski` |
| **gif.js** | Best current JS encoder | npm (used in Node via jsdom/canvas) |
| **gifenc** | Fastest JS encoder | npm |
| **ffmpeg** (palettegen) | Common CLI pipeline | `brew install ffmpeg` |
| **gifsicle** | Post-processing optimizer | `brew install gifsicle` |

The goal: gifhero ≥ gifski on quality metrics, gifhero >> gif.js on both quality and speed.

---

## Test Corpus

Quality varies wildly by content type. Use a fixed corpus that covers every hard case:

### Source Videos (extract as PNG frame sequences)

```
test/fixtures/
├── video-live-action/      # skin tones, motion blur, gradients
│   └── big-buck-bunny/     # standard test clip, CC license
├── video-screencast/       # flat colors, sharp text, large static areas
│   └── vscode-typing/
├── video-animation/        # hard edges, flat fills, limited palette
│   └── anime-clip/
├── video-high-motion/      # sports/gaming, fast camera movement
│   └── racing/
├── video-gradient/         # worst case: smooth color transitions
│   └── sunset/
└── video-low-color/        # easy case: pixel art, simple graphics
    └── pixel-art/
```

**Where to get them:**
- Big Buck Bunny / Sintel / Tears of Steel — open movie project (CC)
- Screen recordings — record yourself in VS Code for 5 seconds
- Gradient stress test — programmatically generate a 3-second video of a rotating color wheel
- Use ffmpeg to extract frames: `ffmpeg -i source.mp4 -vf "fps=20,scale=480:-1" frames/%04d.png`

**Standardize inputs:**
- All test clips: exactly 3 seconds, 20fps (60 frames)
- Resolution: 480px wide, aspect-preserved height
- Extracted as lossless PNG frame sequences (the "ground truth")

---

## Quality Metrics

### Primary: DSSIM (Structural Dissimilarity)

Written by the same author as gifski (Kornel Lesiński). This is what gifski itself targets.

```bash
# Install
brew install dssim   # or: cargo install dssim

# Compare a single frame
dssim original.png gifhero-frame.png
# Output: 0.00234 (lower = better, 0 = identical)
```

**How to measure animated GIFs:**

GIFs need to be decomposed into frames first, then each frame compared against its source:

```bash
# Extract GIF frames
ffmpeg -i output.gif -vsync 0 gif-frames/%04d.png

# Compare each frame pair
for i in $(seq -f "%04d" 1 60); do
  dssim "source-frames/$i.png" "gif-frames/$i.png"
done
```

**Interpretation:**
- < 0.002: Essentially identical (gifski territory)
- 0.002–0.010: Excellent (hard to tell from original)
- 0.010–0.030: Good (noticeable on close inspection)
- 0.030–0.100: Mediocre (clearly degraded)
- > 0.100: Bad

### Secondary: SSIM (Structural Similarity)

More widely known, 0–1 scale where 1 = identical.

```bash
# Node.js — using ssim.js
npm install ssim.js

# In your benchmark script:
import ssim from 'ssim.js';
const { mssim } = await ssim('original.png', 'encoded.png');
// mssim close to 1.0 = good
```

**Targets:**
- > 0.98: Excellent
- 0.95–0.98: Good
- 0.90–0.95: Acceptable
- < 0.90: Failing

### Tertiary: PSNR (Peak Signal-to-Noise Ratio)

Quick and cheap to compute. Less perceptually accurate than SSIM/DSSIM but useful for fast feedback during development:

```bash
ffmpeg -i original.png -i encoded.png -lavfi psnr -f null -
```

Higher is better. 30+ dB is acceptable, 40+ dB is excellent.

---

## Temporal Quality: Flicker Detection

No standard tool exists for this, so we build our own metric. Dither flicker happens when the same pixel gets mapped to different palette entries on consecutive frames, even though the source pixel didn't change.

```
Temporal Flicker Score (TFS):

For each pixel (x, y):
  For each consecutive frame pair (N, N+1):
    source_diff = |source[N](x,y) - source[N+1](x,y)|
    gif_diff = |gif[N](x,y) - gif[N+1](x,y)|
    
    if source_diff < threshold AND gif_diff > threshold:
      flicker_count++

TFS = flicker_count / (total_pixels × total_frame_pairs)
```

Lower TFS = smoother animation. This is where temporal dithering makes its difference. gifski will score well here; gif.js will score poorly.

Build this as `test/metrics/flicker.ts` — it's a unique metric that no one else publishes, and it directly measures temporal dithering effectiveness.

---

## The Benchmark Pipeline

### Automated Script: `test/bench/run.ts`

One command generates GIFs with every tool and compares them:

```
npm run bench

# What it does:
# 1. For each test clip in test/fixtures/:
#    a. Generate GIF with gifhero (each preset)
#    b. Generate GIF with gifski
#    c. Generate GIF with gif.js
#    d. Generate GIF with gifenc
#    e. Generate GIF with ffmpeg palettegen/paletteuse
#
# 2. For each output GIF:
#    a. Extract frames to PNG
#    b. Compute per-frame DSSIM against source
#    c. Compute mean/max/p95 DSSIM
#    d. Compute SSIM
#    e. Compute Temporal Flicker Score
#    f. Record file size
#    g. Record encoding time
#
# 3. Output comparison table + write to test/bench/results/
```

### Reference GIF Generation Commands

```bash
# gifski (gold standard)
gifski --fps 20 --width 480 -o gifski.gif source-frames/*.png

# ffmpeg two-pass palette method
ffmpeg -framerate 20 -i frames/%04d.png \
  -vf "palettegen=stats_mode=diff" palette.png
ffmpeg -framerate 20 -i frames/%04d.png -i palette.png \
  -lavfi "paletteuse=dither=floyd_steinberg" ffmpeg.gif

# gifsicle post-optimization (apply to any GIF)
gifsicle -O3 --lossy=80 input.gif -o optimized.gif
```

### Output Format

Each benchmark run produces a report like:

```
╔══════════════════════════════════════════════════════════════════════╗
║                    gifhero benchmark — 2026-06-22                   ║
╠═════════════════╦═══════╦════════╦══════╦═════════╦════════╦═══════╣
║ Encoder         ║ DSSIM ║ SSIM   ║ TFS  ║ Size KB ║ Time s ║ Score ║
╠═════════════════╬═══════╬════════╬══════╬═════════╬════════╬═══════╣
║ big-buck-bunny                                                      ║
╠─────────────────╬───────╬────────╬──────╬─────────╬────────╬───────╣
║ gifski          ║ 0.003 ║ 0.982  ║ 0.01 ║    824  ║  2.4   ║  ref  ║
║ gifhero quality ║ 0.004 ║ 0.978  ║ 0.02 ║    890  ║  3.1   ║ 0.94  ║
║ gifhero balance ║ 0.008 ║ 0.965  ║ 0.03 ║    620  ║  1.2   ║ 0.87  ║
║ gif.js          ║ 0.018 ║ 0.941  ║ 0.12 ║   1240  ║  4.8   ║ 0.62  ║
║ gifenc          ║ 0.022 ║ 0.932  ║ 0.15 ║    780  ║  0.9   ║ 0.58  ║
║ ffmpeg          ║ 0.012 ║ 0.958  ║ 0.04 ║    920  ║  0.6   ║ 0.78  ║
╚═════════════════╩═══════╩════════╩══════╩═════════╩════════╩═══════╝
```

### Composite Score

A single number for quick comparison. Weighted formula:

```
Score = (DSSIM_weight × dssim_normalized) +
        (TFS_weight × tfs_normalized) +
        (size_weight × size_normalized)

Where:
  dssim_normalized = gifski_dssim / encoder_dssim  (1.0 = matches gifski)
  tfs_normalized   = gifski_tfs / encoder_tfs
  size_normalized  = gifski_size / encoder_size

Weights (quality-focused): DSSIM 0.50, TFS 0.30, Size 0.20
```

Score of 1.0 = identical to gifski on all dimensions. Higher = better than gifski.

---

## Visual Comparison Tool

Numbers are essential but humans catch things metrics miss. Build a simple HTML comparison page:

### `test/bench/compare.html`

A side-by-side viewer that shows:

1. **Original video** (playing as image sequence)
2. **gifhero output** (synced)
3. **gifski output** (synced, reference)
4. **Difference map** (amplified pixel diff, per-frame)
5. **Scrubber** to go frame by frame
6. **Per-frame DSSIM graph** showing quality over time

This runs locally — drop in the output from `npm run bench` and open in browser. Build it as a React artifact (or plain HTML) during development.

---

## Regression Testing

### Quality Gates in CI

Every PR must pass quality thresholds:

```typescript
// test/quality-gates.test.ts
import { describe, it, expect } from 'vitest';

describe('quality gates', () => {
  it('live-action DSSIM < 0.015 (balanced preset)', async () => {
    const result = await encodeBenchmark('video-live-action', 'balanced');
    expect(result.meanDssim).toBeLessThan(0.015);
  });

  it('screencast DSSIM < 0.008 (balanced preset)', async () => {
    const result = await encodeBenchmark('video-screencast', 'balanced');
    expect(result.meanDssim).toBeLessThan(0.008);
  });

  it('temporal flicker score < 0.05 (balanced preset)', async () => {
    const result = await encodeBenchmark('video-live-action', 'balanced');
    expect(result.flickerScore).toBeLessThan(0.05);
  });

  it('output size within 120% of gifski', async () => {
    const gifhero = await encodeBenchmark('video-live-action', 'balanced');
    const reference = await loadReference('gifski', 'video-live-action');
    expect(gifhero.fileSize).toBeLessThan(reference.fileSize * 1.2);
  });

  it('encoding time < 10s for 60 frames at 480p', async () => {
    const result = await encodeBenchmark('video-live-action', 'balanced');
    expect(result.encodingTimeMs).toBeLessThan(10000);
  });
});
```

### Tracking Over Time

Store benchmark results as JSON after each run:

```
test/bench/results/
├── 2026-06-22-abc123.json
├── 2026-06-23-def456.json
└── latest.json → symlink
```

Plot trends to catch regressions or confirm improvements. A simple chart in the compare tool showing DSSIM over git commits.

---

## Development Workflow

### Phase-Appropriate Testing

**Phase 1 (GIF writer + NeuQuant + Floyd-Steinberg):**
- Only compare against gif.js (most similar feature set)
- Focus on DSSIM and SSIM — just make sure basic encoding works
- Target: DSSIM ≤ gif.js (match it, don't need to beat it yet)

**Phase 2 (Frame diff + disposal + more quantizers):**
- Add ffmpeg and gifenc to comparisons
- Start measuring file size — frame diff should show dramatic improvement
- Target: DSSIM ≤ gif.js AND file size < gif.js

**Phase 3 (Temporal dithering + cross-frame palettes + lossy LZW):**
- Add gifski to comparisons — this is where we compete at the top
- Start measuring TFS — temporal dithering should destroy gif.js on flicker
- Target: DSSIM within 2× of gifski, TFS within 3× of gifski

**Phase 4 (WASM quantizer + polish):**
- Full benchmark suite against all competitors
- Target: DSSIM within 1.5× of gifski, TFS within 2× of gifski
- Stretch goal: match gifski on one or more test clips

---

## Quick Start

```bash
# Install comparison tools
brew install gifski gifsicle dssim ffmpeg

# Prepare test fixtures (first time only)
npm run bench:setup
# Downloads open-source test clips and extracts frame sequences

# Run full benchmark
npm run bench

# View visual comparison
open test/bench/compare.html

# Run quality gate tests
npm run test:quality
```
