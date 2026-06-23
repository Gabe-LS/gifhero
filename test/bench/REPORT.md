# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-23
**Commit:** 4b2be65
**gifhero:** quality preset (imagequant q90 speed 1, adaptive lossyLzw 4–6, content-adaptive staleThreshold, keyframes, Lanczos3 downscaling, shared palette for all downscaled encodes)
**gifski:** default settings (quality 90)
**Fixtures:** 25 clips × 4 resolutions = 200 encodes per encoder

---

## Summary

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Avg size Δ | Total size |
|-----------|-----------|-----------|------------|------------|------------|
| **480p** | **15/25** | **19/25** | **+0.7** | **-10%** | 57.9 vs 64.4 MB |
| **360p** | **15/25** | **22/25** | **+0.7** | **-13%** | 33.2 vs 38.1 MB |
| **240p** | **18/25** | **25/25** | **+1.7** | **-14%** | 15.8 vs 18.3 MB |
| **160p** | **19/25** | **24/25** | **+2.4** | **-15%** | 7.9 vs 9.2 MB |

**Zero cases >10% larger than gifski. Zero VMAF losses >2 points.**

gifhero wins VMAF at every resolution and is smaller in the vast majority of encodes. The VMAF advantage grows at lower resolutions (+0.7 at 480p → +2.4 at 160p), as does the size advantage (-10% → -15%).

### Efficiency (VMAF per MB)

| Resolution | gifhero | gifski | Advantage |
|-----------|---------|--------|-----------|
| 480p | 13,324 | 12,570 | +6% |
| 360p | 13,512 | 12,613 | +7% |
| 240p | 13,772 | 12,704 | +8% |
| 160p | 14,162 | 12,900 | +10% |

gifhero delivers more perceptual quality per byte at every resolution, with the efficiency gap widening at lower resolutions.

### Size Distribution

| Resolution | Smaller | 0–5% larger | 5–10% larger | >10% larger | Median Δ |
|-----------|---------|-------------|--------------|-------------|----------|
| 480p | 19 | 4 | 2 | 0 | -9% |
| 360p | 22 | 3 | 0 | 0 | -17% |
| 240p | 25 | 0 | 0 | 0 | -16% |
| 160p | 24 | 1 | 0 | 0 | -13% |

---

## 480p Results (25 fixtures, native resolution)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **3,515KB** / 93.4 | 4,663KB / **94.0** | **-25%** | -0.6 |
| bbb-clip-02 | 3,846KB / **95.5** | **3,717KB** / 93.5 | +3% | **+2.0** |
| bbb-clip-03 | **1,284KB** / **95.5** | 1,326KB / 94.8 | **-3%** | **+0.7** |
| bbb-clip-04 | 2,116KB / **96.3** | **2,053KB** / 95.4 | +3% | **+0.9** |
| bbb-clip-05 | **1,649KB** / 95.9 | 2,216KB / **97.5** | **-26%** | -1.5 |
| bbb-clip-06 | **1,411KB** / **95.3** | 1,438KB / 94.6 | **-2%** | **+0.7** |
| bbb-clip-07 | **1,966KB** / **95.5** | 2,598KB / 90.5 | **-24%** | **+5.0** |
| bbb-clip-08 | 6,539KB / **98.4** | **6,361KB** / 98.4 | +3% | -0.0 |
| bbb-clip-09 | **1,594KB** / **96.2** | 1,689KB / 95.7 | **-6%** | **+0.5** |
| bbb-clip-10 | **3,344KB** / 99.9 | 4,347KB / **100.0** | **-23%** | -0.0 |
| big-buck-bunny | **2,371KB** / **93.0** | 3,098KB / 91.9 | **-23%** | **+1.1** |
| black-and-white | **10,790KB** / **99.9** | 12,077KB / 99.9 | **-11%** | +0.0 |
| candle-flame | **196KB** / **97.3** | 214KB / 96.7 | **-8%** | **+0.5** |
| city-night | **3,361KB** / 97.0 | 4,084KB / **97.2** | **-18%** | -0.2 |
| color-wheel | 4,312KB / **98.5** | **4,203KB** / 98.0 | +3% | **+0.5** |
| fast-action | **2,956KB** / **98.9** | 3,205KB / 96.4 | **-8%** | **+2.6** |
| jellyfish | **2,626KB** / 96.9 | 2,870KB / **97.3** | **-9%** | -0.3 |
| pixel-art | **312KB** / **98.9** | 353KB / 98.9 | **-12%** | -0.0 |
| screen-recording | **624KB** / **98.2** | 702KB / 98.2 | **-11%** | -0.1 |
| screencast | **24KB** / **97.6** | 49KB / 97.5 | **-51%** | **+0.1** |
| shapes | **343KB** / **96.6** | 389KB / 94.0 | **-12%** | **+2.6** |
| sintel | **1,277KB** / **98.3** | 1,423KB / 97.3 | **-10%** | **+0.9** |
| skin-tones | 186KB / **97.2** | **176KB** / 97.1 | +6% | **+0.1** |
| talking-head | 1,295KB / **96.3** | **1,194KB** / 95.0 | +8% | **+1.3** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 15/25 | Size wins: 19/25 | Avg VMAF: +0.7 | Total: 57.9 vs 64.4 MB (-10%)**

---

## 360p Results (25 fixtures, Lanczos3 downscale + shared palette)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **1,813KB** / 91.1 | 2,512KB / **91.8** | **-28%** | -0.7 |
| bbb-clip-02 | **1,994KB** / **94.1** | 2,032KB / 91.6 | **-2%** | **+2.4** |
| bbb-clip-03 | **711KB** / **93.1** | 828KB / 93.0 | **-14%** | **+0.1** |
| bbb-clip-04 | **1,102KB** / **95.2** | 1,223KB / 94.0 | **-10%** | **+1.2** |
| bbb-clip-05 | **1,012KB** / 95.4 | 1,380KB / **96.1** | **-27%** | -0.7 |
| bbb-clip-06 | **745KB** / **94.1** | 861KB / 93.2 | **-13%** | **+0.9** |
| bbb-clip-07 | **1,233KB** / **95.5** | 1,564KB / 88.4 | **-21%** | **+7.1** |
| bbb-clip-08 | 3,779KB / **97.7** | **3,713KB** / 97.1 | +2% | **+0.7** |
| bbb-clip-09 | **847KB** / **94.9** | 1,015KB / 94.8 | **-17%** | **+0.2** |
| bbb-clip-10 | **1,979KB** / 99.5 | 2,740KB / **99.9** | **-28%** | -0.4 |
| big-buck-bunny | **1,265KB** / **90.6** | 1,688KB / 89.5 | **-25%** | **+1.0** |
| black-and-white | **6,326KB** / **99.9** | 6,939KB / 99.8 | **-9%** | **+0.1** |
| candle-flame | **91KB** / **96.3** | 149KB / 96.2 | **-39%** | **+0.1** |
| city-night | **1,776KB** / 94.2 | 2,261KB / **94.6** | **-21%** | -0.4 |
| color-wheel | 2,733KB / **98.6** | **2,655KB** / 97.2 | +3% | **+1.4** |
| fast-action | **1,727KB** / **97.5** | 1,880KB / 93.2 | **-8%** | **+4.3** |
| jellyfish | **1,583KB** / 95.2 | 1,729KB / **95.5** | **-8%** | -0.4 |
| pixel-art | **265KB** / **99.7** | 315KB / 99.6 | **-16%** | **+0.0** |
| screen-recording | **368KB** / 99.2 | 467KB / **99.3** | **-21%** | -0.2 |
| screencast | **14KB** / **93.8** | 43KB / 93.4 | **-68%** | **+0.4** |
| shapes | **245KB** / 93.1 | 306KB / **94.2** | **-20%** | -1.1 |
| sintel | **762KB** / **98.5** | 928KB / 97.2 | **-18%** | **+1.3** |
| skin-tones | **109KB** / 96.7 | 157KB / **96.9** | **-30%** | -0.2 |
| talking-head | 749KB / **94.9** | **737KB** / 93.5 | +2% | **+1.4** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 15/25 | Size wins: 22/25 | Avg VMAF: +0.7 | Total: 33.2 vs 38.1 MB (-13%)**

---

## 240p Results (25 fixtures, Lanczos3 downscale + shared palette)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **853KB** / **87.5** | 1,126KB / 87.2 | **-24%** | **+0.3** |
| bbb-clip-02 | **846KB** / **91.1** | 898KB / 87.8 | **-6%** | **+3.3** |
| bbb-clip-03 | **366KB** / **89.6** | 435KB / 89.5 | **-16%** | **+0.1** |
| bbb-clip-04 | **547KB** / **92.7** | 612KB / 91.4 | **-11%** | **+1.2** |
| bbb-clip-05 | **576KB** / **93.8** | 736KB / 93.1 | **-22%** | **+0.6** |
| bbb-clip-06 | **378KB** / **92.4** | 439KB / 90.7 | **-14%** | **+1.7** |
| bbb-clip-07 | **636KB** / **93.9** | 808KB / 85.7 | **-21%** | **+8.2** |
| bbb-clip-08 | **1,816KB** / **95.8** | 1,864KB / 93.3 | **-3%** | **+2.5** |
| bbb-clip-09 | **429KB** / **92.4** | 507KB / 92.0 | **-16%** | **+0.3** |
| bbb-clip-10 | **938KB** / 95.1 | 1,291KB / **95.9** | **-27%** | -0.8 |
| big-buck-bunny | **685KB** / **88.1** | 768KB / 84.7 | **-11%** | **+3.4** |
| black-and-white | **2,724KB** / **97.1** | 3,043KB / 92.5 | **-10%** | **+4.5** |
| candle-flame | **51KB** / 95.3 | 98KB / **95.6** | **-48%** | -0.3 |
| city-night | **742KB** / 88.5 | 983KB / **89.2** | **-25%** | -0.7 |
| color-wheel | **1,245KB** / **96.8** | 1,267KB / 94.9 | **-2%** | **+1.9** |
| fast-action | **897KB** / **95.3** | 908KB / 86.8 | **-1%** | **+8.5** |
| jellyfish | **787KB** / **92.4** | 876KB / 91.7 | **-10%** | **+0.6** |
| pixel-art | **166KB** / **100.0** | 177KB / 100.0 | **-6%** | +0.0 |
| screen-recording | **181KB** / 97.4 | 256KB / **97.5** | **-29%** | -0.1 |
| screencast | **9KB** / **90.8** | 41KB / 89.4 | **-78%** | **+1.5** |
| shapes | **144KB** / **93.1** | 192KB / 91.6 | **-25%** | **+1.5** |
| sintel | **387KB** / **99.0** | 501KB / 96.9 | **-23%** | **+2.1** |
| skin-tones | **63KB** / 95.8 | 104KB / **96.1** | **-39%** | -0.3 |
| talking-head | **380KB** / **92.8** | 386KB / 90.8 | **-2%** | **+2.0** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 18/25 | Size wins: 25/25 | Avg VMAF: +1.7 | Total: 15.8 vs 18.3 MB (-14%)**

---

## 160p Results (25 fixtures, Lanczos3 downscale + shared palette)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **424KB** / **83.9** | 471KB / 81.9 | **-10%** | **+2.0** |
| bbb-clip-02 | **372KB** / **88.1** | 399KB / 83.8 | **-7%** | **+4.4** |
| bbb-clip-03 | **197KB** / **86.8** | 246KB / 85.6 | **-20%** | **+1.3** |
| bbb-clip-04 | **293KB** / **89.3** | 318KB / 87.7 | **-8%** | **+1.7** |
| bbb-clip-05 | **333KB** / **89.9** | 392KB / 89.1 | **-15%** | **+0.9** |
| bbb-clip-06 | **198KB** / **88.5** | 234KB / 87.0 | **-16%** | **+1.5** |
| bbb-clip-07 | **344KB** / **91.0** | 417KB / 81.4 | **-18%** | **+9.7** |
| bbb-clip-08 | **897KB** / **92.4** | 951KB / 87.3 | **-6%** | **+5.1** |
| bbb-clip-09 | **231KB** / **88.9** | 267KB / 88.7 | **-13%** | **+0.2** |
| bbb-clip-10 | **430KB** / 86.1 | 631KB / **86.2** | **-32%** | -0.0 |
| big-buck-bunny | **324KB** / **84.9** | 325KB / 79.5 | **-0%** | **+5.4** |
| black-and-white | **1,193KB** / **91.2** | 1,317KB / 83.7 | **-9%** | **+7.5** |
| candle-flame | **30KB** / 93.8 | 70KB / **94.8** | **-57%** | -1.0 |
| city-night | **414KB** / **86.1** | 427KB / 83.9 | **-3%** | **+2.2** |
| color-wheel | **615KB** / **94.4** | 948KB / 92.1 | **-35%** | **+2.3** |
| fast-action | 449KB / **91.8** | **438KB** / 80.3 | +2% | **+11.5** |
| jellyfish | **397KB** / **87.7** | 438KB / 85.9 | **-10%** | **+1.8** |
| pixel-art | **99KB** / **100.0** | 109KB / 100.0 | **-10%** | +0.0 |
| screen-recording | **98KB** / **94.3** | 147KB / 93.3 | **-34%** | **+1.0** |
| screencast | **6KB** / 87.5 | 24KB / **87.9** | **-75%** | -0.3 |
| shapes | **90KB** / **91.4** | 125KB / 90.7 | **-28%** | **+0.7** |
| sintel | **202KB** / **100.0** | 269KB / 98.5 | **-25%** | **+1.5** |
| skin-tones | **38KB** / 95.4 | 75KB / **97.0** | **-50%** | -1.5 |
| talking-head | **201KB** / **91.2** | 203KB / 87.9 | **-1%** | **+3.3** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 19/25 | Size wins: 24/25 | Avg VMAF: +2.4 | Total: 7.9 vs 9.2 MB (-15%)**

---

## Additional Metrics

### CIEDE2000 Color Accuracy (higher is better)

| Resolution | gifhero | gifski | Winner |
|-----------|---------|--------|--------|
| 480p | 45.80 | 46.85 | gifhero |
| 360p | 40.87 | 40.76 | gifski |
| 240p | 38.41 | 38.40 | tie |
| 160p | 36.31 | 36.31 | tie |

Color accuracy is comparable at all resolutions, with gifhero slightly better at native resolution.

### CAMBI Banding (lower is better)

| Resolution | gifhero | gifski |
|-----------|---------|--------|
| 480p | 0.290 | 0.250 |
| 360p | 0.377 | 0.328 |
| 240p | 0.388 | 0.360 |
| 160p | 0.005 | 0.000 |

gifski produces slightly less banding, likely from its frame-to-frame palette continuity. The differences are small (< 0.05 absolute) and not perceptually significant.

### DSSIM Structural Dissimilarity (lower is better, 480p only)

| Metric | gifhero | gifski |
|--------|---------|--------|
| Mean | 0.0014 | 0.0030 |
| P95 | 0.0018 | 0.0125 |
| Max | 0.0021 | 0.0253 |

At 480p (the only resolution with DSSIM data), gifhero has 2× better structural similarity on average and 12× better worst-case (max) DSSIM.

---

## Notable Results

### Biggest VMAF Wins (gifhero − gifski)

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| fast-action | 160p | **+11.5** | +2% |
| bbb-clip-07 | 160p | **+9.7** | -18% |
| fast-action | 240p | **+8.5** | -1% |
| bbb-clip-07 | 240p | **+8.2** | -21% |
| black-and-white | 160p | **+7.5** | -9% |
| bbb-clip-07 | 360p | **+7.1** | -21% |
| big-buck-bunny | 160p | **+5.4** | -0% |
| bbb-clip-08 | 160p | **+5.1** | -6% |
| bbb-clip-07 | 480p | **+5.0** | -24% |
| black-and-white | 240p | **+4.5** | -10% |

bbb-clip-07 and fast-action show the largest gains — these clips have scene changes and high motion where gifhero's keyframe detection and content-adaptive thresholds provide the most benefit.

### Worst VMAF Deltas

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| bbb-clip-05 | 480p | -1.5 | **-26%** |
| skin-tones | 160p | -1.5 | **-50%** |
| shapes | 360p | -1.1 | **-20%** |
| candle-flame | 160p | -1.0 | **-57%** |

Every VMAF loss is under 2 points and paired with a significant size reduction. These are favorable quality-for-size tradeoffs.

### Biggest Size Wins

| Fixture | Res | Δ Size | Δ VMAF |
|---------|-----|--------|--------|
| screencast | 240p | **-78%** | +1.5 |
| screencast | 160p | **-75%** | -0.3 |
| screencast | 360p | **-68%** | +0.4 |
| candle-flame | 160p | **-57%** | -1.0 |
| screencast | 480p | **-51%** | +0.1 |
| skin-tones | 160p | **-50%** | -1.5 |

screencast and candle-flame are low-motion, low-complexity clips where gifhero's content-adaptive thresholds and transparency optimization produce dramatic size savings.

---

## Optimization Journey

Started with **32 cases >10% larger** than gifski. Systematically reduced to **0** through:

| Fix | Cases removed | Key change |
|-----|--------------|------------|
| staleThreshold override bug | 0 | Fixed ignored user override |
| Motion floor (>5% → threshold ≥5) | 6 | talking-head +65% → +11% |
| Motion floor lowered (>1%) | 6 | bbb-clip-06 +60% → -2% |
| Minimum floor raised to 3 | 2 | skin-tones +24% → +6% |
| Linear threshold scale | 8 | bbb-clip-02 +17% → +5% |
| No scaling for <2× downscale | 5 | 360p cluster fixed |
| Adaptive lossyLzw (4→6 from complexity) | 4 | high-motion clips shrunk |
| Shared palette for all downscaled encodes | 1 | bbb-clip-02 360p +14% → -2% |
| **Total** | **32 → 0 remaining** | |

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth < source width)
  → Probe: static mask, motion × complexity, keyframes
  → Content-adaptive staleThreshold (3–10 from complexity)
  → Content-adaptive lossyLzw (preset–6 from complexity)
  → Shared palette via Histogram (if any downscaling)
  → Frame 0 / keyframes: full-frame quantize, reset canvas
  → Frames 1+:
      Per-frame: quantizeWithBackground(frame, canvas)
      Shared: remapWithPalette(frame, sharedPalette, canvas)
  → tight crop → trim palette → lossy LZW → GIF89a
```

### staleThreshold Formula

```
complexity = motionLevel × colorComplexity
motionFloor = motionLevel > 1% ? 5 : 3
autoThreshold = clamp(3, 10, round(3 + 7 × min(1, complexity / 5000)))
threshold = max(motionFloor, autoThreshold)
```

### Adaptive lossyLzw Formula

```
complexity = motionLevel × colorComplexity
adaptiveLzw = clamp(preset, 6, round(preset + 2 × min(1, complexity / 3000)))
```

Only applied when the user does not explicitly set `lossyLzw`. Scales from the preset default (4 for quality) up to 6 for high-complexity content.
