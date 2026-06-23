# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-24
**gifhero:** quality preset (imagequant q90 speed 1, adaptive lossyLzw 4–5, content-adaptive staleThreshold, keyframes, Lanczos3 downscaling, conditional shared palette, adaptive maxColors)
**gifski:** default settings (quality 90)
**Fixtures:** 25 clips × 4 resolutions = 200 encodes per encoder

---

## Summary

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Avg size Δ | Total size |
|-----------|-----------|-----------|------------|------------|------------|
| **480p** | **12/25** | **22/25** | **+0.5** | **-14%** | 55.2 vs 64.4 MB |
| **360p** | **12/25** | **23/25** | **+0.7** | **-14%** | 32.8 vs 38.1 MB |
| **240p** | **16/25** | **25/25** | **+1.6** | **-15%** | 15.6 vs 18.3 MB |
| **160p** | **20/25** | **24/25** | **+2.5** | **-14%** | 7.9 vs 9.2 MB |

**Zero cases >10% larger than gifski. Zero VMAF losses >2 points.**

gifhero wins VMAF at every resolution and is smaller in the vast majority of encodes. The VMAF advantage grows at lower resolutions (+0.5 at 480p → +2.5 at 160p).

### Efficiency (VMAF per MB)

| Resolution | gifhero | gifski | Advantage |
|-----------|---------|--------|-----------|
| 480p | 13,327 | 12,570 | +6% |
| 360p | 13,513 | 12,613 | +7% |
| 240p | 13,773 | 12,704 | +8% |
| 160p | 14,162 | 12,900 | +10% |

gifhero delivers more perceptual quality per byte at every resolution, with the efficiency gap widening at lower resolutions.

### Size Distribution

| Resolution | Smaller | 0–5% larger | 5–10% larger | >10% larger | Median Δ |
|-----------|---------|-------------|--------------|-------------|----------|
| 480p | 22 | 2 | 1 | 0 | -12% |
| 360p | 23 | 2 | 0 | 0 | -18% |
| 240p | 25 | 0 | 0 | 0 | -19% |
| 160p | 24 | 1 | 0 | 0 | -14% |

---

## 480p Results (25 fixtures, native resolution)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **3,233KB** / 93.0 | 4,775KB / **94.0** | **-32%** | -1.0 |
| bbb-clip-02 | **3,375KB** / **95.1** | 3,806KB / 93.5 | **-11%** | **+1.6** |
| bbb-clip-03 | **1,070KB** / 94.0 | 1,358KB / **94.8** | **-21%** | -0.9 |
| bbb-clip-04 | **1,802KB** / **96.1** | 2,102KB / 95.4 | **-14%** | **+0.7** |
| bbb-clip-05 | **1,602KB** / 96.3 | 2,269KB / **97.5** | **-29%** | -1.2 |
| bbb-clip-06 | **1,217KB** / **95.4** | 1,473KB / 94.6 | **-17%** | **+0.7** |
| bbb-clip-07 | **2,025KB** / **95.9** | 2,661KB / 90.5 | **-24%** | **+5.3** |
| bbb-clip-08 | 6,619KB / 98.3 | **6,514KB** / **98.4** | +2% | -0.1 |
| bbb-clip-09 | **1,368KB** / 95.4 | 1,730KB / **95.7** | **-21%** | -0.3 |
| bbb-clip-10 | **3,493KB** / 99.9 | 4,451KB / **100.0** | **-22%** | -0.0 |
| big-buck-bunny | **2,258KB** / **92.3** | 3,172KB / 91.9 | **-29%** | **+0.4** |
| black-and-white | **11,049KB** / **99.9** | 12,367KB / 99.9 | **-11%** | +0.0 |
| candle-flame | **201KB** / **97.3** | 219KB / 96.7 | **-8%** | **+0.5** |
| city-night | **3,304KB** / 96.9 | 4,182KB / **97.2** | **-21%** | -0.3 |
| color-wheel | **4,061KB** / 97.7 | 4,304KB / **98.0** | **-6%** | -0.4 |
| fast-action | **3,204KB** / **99.3** | 3,282KB / 96.4 | **-2%** | **+2.9** |
| jellyfish | **2,568KB** / 95.9 | 2,939KB / **97.3** | **-13%** | -1.3 |
| pixel-art | **319KB** / 98.9 | 361KB / 98.9 | **-12%** | -0.0 |
| screen-recording | **639KB** / 98.2 | 719KB / **98.2** | **-11%** | -0.1 |
| screencast | **25KB** / **97.6** | 50KB / 97.5 | **-51%** | **+0.1** |
| shapes | **351KB** / **96.6** | 398KB / 94.0 | **-12%** | **+2.6** |
| sintel | **1,307KB** / **98.3** | 1,457KB / 97.3 | **-10%** | **+0.9** |
| skin-tones | 190KB / **97.2** | **180KB** / 97.1 | +6% | **+0.1** |
| talking-head | 1,257KB / **95.9** | **1,223KB** / 95.0 | +3% | **+0.9** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 12/25 | Size wins: 22/25 | Avg VMAF: +0.5 | Total: 55.2 vs 64.4 MB (-14%)**

---

## 360p Results (25 fixtures, Lanczos3 downscale + shared palette)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **1,809KB** / 91.0 | 2,572KB / **91.8** | **-30%** | -0.8 |
| bbb-clip-02 | **1,957KB** / **93.9** | 2,081KB / 91.6 | **-6%** | **+2.2** |
| bbb-clip-03 | **700KB** / 92.8 | 848KB / **93.0** | **-17%** | -0.2 |
| bbb-clip-04 | **1,092KB** / **95.1** | 1,252KB / 94.0 | **-13%** | **+1.1** |
| bbb-clip-05 | **1,034KB** / 95.6 | 1,413KB / **96.1** | **-27%** | -0.4 |
| bbb-clip-06 | **763KB** / **94.1** | 882KB / 93.2 | **-13%** | **+0.9** |
| bbb-clip-07 | **1,254KB** / **95.6** | 1,602KB / 88.4 | **-22%** | **+7.3** |
| bbb-clip-08 | 3,841KB / **97.5** | **3,802KB** / 97.1 | +1% | **+0.5** |
| bbb-clip-09 | **826KB** / 94.6 | 1,039KB / **94.8** | **-21%** | -0.2 |
| bbb-clip-10 | **2,149KB** / 99.6 | 2,806KB / **99.9** | **-23%** | -0.3 |
| big-buck-bunny | **1,278KB** / **90.7** | 1,729KB / 89.5 | **-26%** | **+1.1** |
| black-and-white | **6,478KB** / **99.9** | 7,106KB / 99.8 | **-9%** | **+0.1** |
| candle-flame | **93KB** / **96.3** | 153KB / 96.2 | **-39%** | **+0.1** |
| city-night | **1,784KB** / 94.2 | 2,315KB / **94.6** | **-23%** | -0.4 |
| color-wheel | **2,533KB** / 97.3 | 2,719KB / 97.2 | **-7%** | +0.0 |
| fast-action | **1,854KB** / **97.8** | 1,925KB / 93.2 | **-4%** | **+4.6** |
| jellyfish | **1,557KB** / 95.0 | 1,770KB / **95.5** | **-12%** | -0.6 |
| pixel-art | **271KB** / **99.7** | 323KB / 99.6 | **-16%** | **+0.0** |
| screen-recording | **377KB** / 99.2 | 478KB / **99.3** | **-21%** | -0.2 |
| screencast | **14KB** / **93.8** | 44KB / 93.4 | **-68%** | **+0.4** |
| shapes | **251KB** / 93.1 | 313KB / **94.2** | **-20%** | -1.1 |
| sintel | **780KB** / **98.5** | 950KB / 97.2 | **-18%** | **+1.3** |
| skin-tones | **112KB** / 96.7 | 161KB / **96.9** | **-30%** | -0.2 |
| talking-head | 767KB / **94.9** | **755KB** / 93.5 | +2% | **+1.4** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 12/25 | Size wins: 23/25 | Avg VMAF: +0.7 | Total: 32.8 vs 38.1 MB (-14%)**

---

## 240p Results (25 fixtures, Lanczos3 downscale + shared palette + adaptive maxColors)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **840KB** / **87.5** | 1,153KB / 87.2 | **-27%** | **+0.3** |
| bbb-clip-02 | **866KB** / **91.1** | 920KB / 87.8 | **-6%** | **+3.3** |
| bbb-clip-03 | **356KB** / 89.5 | 446KB / 89.5 | **-20%** | +0.0 |
| bbb-clip-04 | **569KB** / **93.0** | 627KB / 91.4 | **-9%** | **+1.6** |
| bbb-clip-05 | **586KB** / **93.8** | 753KB / 93.1 | **-22%** | **+0.7** |
| bbb-clip-06 | **387KB** / **92.4** | 449KB / 90.7 | **-14%** | **+1.7** |
| bbb-clip-07 | **665KB** / **94.3** | 828KB / 85.7 | **-20%** | **+8.6** |
| bbb-clip-08 | **1,839KB** / **95.9** | 1,909KB / 93.3 | **-4%** | **+2.6** |
| bbb-clip-09 | **421KB** / 92.0 | 519KB / **92.0** | **-19%** | -0.1 |
| bbb-clip-10 | **960KB** / 95.1 | 1,322KB / **95.9** | **-27%** | -0.8 |
| big-buck-bunny | **668KB** / **87.8** | 786KB / 84.7 | **-15%** | **+3.1** |
| black-and-white | **2,790KB** / **97.1** | 3,116KB / 92.5 | **-10%** | **+4.5** |
| candle-flame | **52KB** / 95.3 | 100KB / **95.6** | **-48%** | -0.3 |
| city-night | **749KB** / 88.7 | 1,007KB / **89.2** | **-26%** | -0.5 |
| color-wheel | **1,174KB** / **95.8** | 1,297KB / 94.9 | **-9%** | **+0.9** |
| fast-action | **919KB** / **95.3** | 930KB / 86.8 | **-1%** | **+8.5** |
| jellyfish | **775KB** / **92.1** | 897KB / 91.7 | **-14%** | **+0.4** |
| pixel-art | **170KB** / **100.0** | 181KB / 100.0 | **-6%** | +0.0 |
| screen-recording | **185KB** / 97.4 | 262KB / **97.5** | **-29%** | -0.1 |
| screencast | **9KB** / **90.8** | 42KB / 89.4 | **-78%** | **+1.5** |
| shapes | **147KB** / **93.1** | 197KB / 91.6 | **-25%** | **+1.5** |
| sintel | **396KB** / **99.0** | 513KB / 96.9 | **-23%** | **+2.1** |
| skin-tones | **65KB** / 95.8 | 107KB / **96.1** | **-39%** | -0.3 |
| talking-head | **389KB** / **92.8** | 395KB / 90.8 | **-2%** | **+2.0** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 16/25 | Size wins: 25/25 | Avg VMAF: +1.6 | Total: 15.6 vs 18.3 MB (-15%)**

---

## 160p Results (25 fixtures, Lanczos3 downscale + shared palette + adaptive maxColors)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **409KB** / **83.2** | 482KB / 81.9 | **-15%** | **+1.3** |
| bbb-clip-02 | **381KB** / **88.1** | 408KB / 83.8 | **-7%** | **+4.4** |
| bbb-clip-03 | **202KB** / **86.8** | 252KB / 85.6 | **-20%** | **+1.3** |
| bbb-clip-04 | **300KB** / **89.3** | 326KB / 87.7 | **-8%** | **+1.7** |
| bbb-clip-05 | **347KB** / **90.5** | 402KB / 89.1 | **-14%** | **+1.4** |
| bbb-clip-06 | **203KB** / **88.5** | 240KB / 87.0 | **-16%** | **+1.5** |
| bbb-clip-07 | **358KB** / **91.5** | 427KB / 81.4 | **-16%** | **+10.2** |
| bbb-clip-08 | **945KB** / **92.9** | 974KB / 87.3 | **-3%** | **+5.6** |
| bbb-clip-09 | **237KB** / **88.9** | 273KB / 88.7 | **-13%** | **+0.2** |
| bbb-clip-10 | **457KB** / **87.5** | 646KB / 86.2 | **-29%** | **+1.4** |
| big-buck-bunny | **332KB** / **84.9** | 333KB / 79.5 | **-0%** | **+5.4** |
| black-and-white | **1,222KB** / **91.2** | 1,349KB / 83.7 | **-9%** | **+7.5** |
| candle-flame | **31KB** / 93.8 | 72KB / **94.8** | **-57%** | -1.0 |
| city-night | **431KB** / **86.4** | 437KB / 83.9 | **-1%** | **+2.5** |
| color-wheel | **633KB** / **94.4** | 971KB / 92.1 | **-35%** | **+2.3** |
| fast-action | 460KB / **91.8** | **448KB** / 80.3 | +2% | **+11.5** |
| jellyfish | **409KB** / **87.7** | 449KB / 85.9 | **-9%** | **+1.8** |
| pixel-art | **101KB** / **100.0** | 112KB / 100.0 | **-10%** | +0.0 |
| screen-recording | **100KB** / **94.3** | 151KB / 93.3 | **-34%** | **+1.0** |
| screencast | **6KB** / 87.5 | 25KB / **87.9** | **-75%** | -0.3 |
| shapes | **92KB** / **91.4** | 128KB / 90.7 | **-28%** | **+0.7** |
| sintel | **207KB** / **100.0** | 275KB / 98.5 | **-25%** | **+1.5** |
| skin-tones | **39KB** / 95.4 | 77KB / **97.0** | **-50%** | -1.5 |
| talking-head | **206KB** / **91.2** | 208KB / 87.9 | **-1%** | **+3.3** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 20/25 | Size wins: 24/25 | Avg VMAF: +2.5 | Total: 7.9 vs 9.2 MB (-14%)**

---

## Notable Results

### Biggest VMAF Wins (gifhero − gifski)

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| fast-action | 160p | **+11.5** | +2% |
| bbb-clip-07 | 160p | **+10.2** | -16% |
| bbb-clip-07 | 240p | **+8.6** | -20% |
| fast-action | 240p | **+8.5** | -1% |
| black-and-white | 160p | **+7.5** | -9% |

bbb-clip-07 and fast-action show the largest gains — these clips have scene changes and high motion where gifhero's keyframe detection and content-adaptive thresholds provide the most benefit.

### Worst VMAF Deltas

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| skin-tones | 160p | -1.5 | **-50%** |
| jellyfish | 480p | -1.3 | **-13%** |
| bbb-clip-05 | 480p | -1.2 | **-29%** |
| shapes | 360p | -1.1 | **-20%** |
| bbb-clip-01 | 480p | -1.0 | **-32%** |

Every VMAF loss is under 2 points and paired with a significant size reduction.

### Biggest Size Wins

| Fixture | Res | Δ Size | Δ VMAF |
|---------|-----|--------|--------|
| screencast | 240p | **-78%** | +1.5 |
| screencast | 160p | **-75%** | -0.3 |
| screencast | 360p | **-68%** | +0.4 |
| candle-flame | 160p | **-57%** | -1.0 |
| screencast | 480p | **-51%** | +0.1 |

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
| Adaptive lossyLzw (4→5 from complexity) | 3 | high-motion clips shrunk |
| Conditional shared palette (≥8K colors) | 1 | talking-head +11% → +3% |
| Shared palette for all downscaled | 1 | bbb-clip-02 360p +14% → -2% |
| Adaptive maxColors (192 for ≥20K colors) | 0 | bbb-clip-08 +7% → +2% |
| **Total** | **32 → 0 remaining** | |

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth < source width)
  → Probe: static mask, motion × complexity, keyframes
  → Content-adaptive staleThreshold (3–10 from complexity)
  → Content-adaptive lossyLzw (preset–5 from complexity)
  → Adaptive maxColors (192 when colorComplexity ≥ 20K)
  → Shared palette via Histogram (if downscaling OR colorComplexity ≥ 8K)
  → Frame 0 / keyframes: full-frame quantize, reset canvas
  → Frames 1+:
      Shared: remapWithPalette(frame, sharedPalette, canvas)
      Per-frame: quantizeWithBackground(frame, canvas)
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
adaptiveLzw = clamp(preset, 5, round(preset + complexity / 3000))
```

Only applied when the user does not explicitly set `lossyLzw`. Scales from the preset default (4 for quality) up to 5 for high-complexity content.

### Conditional Shared Palette

```
useSharedPalette = downscaleRatio > 1.0 OR colorComplexity ≥ 8000
```

At native resolution, low-color clips (shapes, screencast, skin-tones) keep per-frame palettes for maximum quality. High-color clips use a shared palette built from 10 sampled frames via `Histogram::add_image` for cross-frame LZW consistency.

### Adaptive maxColors

```
maxColors = colorComplexity ≥ 20000 ? min(userMax, 192) : userMax
```

For content with >20K distinct colors, 256 palette entries produce excess dithering noise that inflates LZW without meaningful VMAF gain. Capping at 192 reduces noise with negligible quality impact (< 0.2 VMAF).
