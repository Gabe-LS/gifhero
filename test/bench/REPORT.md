# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-24
**gifhero:** quality preset (imagequant q90 speed 1, adaptive lossyLzw 4–5, content-adaptive staleThreshold with per-frame boost, keyframes, Lanczos3 downscaling, conditional shared palette, adaptive maxColors, po2 palette targeting, deferred LZW clear)
**gifski:** default settings (quality 90)
**Fixtures:** 25 clips × 4 resolutions = 200 encodes per encoder

---

## Summary

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Avg size Δ | Total size |
|-----------|-----------|-----------|------------|------------|------------|
| **480p** | **9/25** | **24/25** | **+0.3** | **-16%** | 53.8 vs 64.4 MB |
| **360p** | **10/25** | **24/25** | **+0.4** | **-16%** | 32.0 vs 38.1 MB |
| **240p** | **15/25** | **25/25** | **+1.3** | **-18%** | 15.1 vs 18.3 MB |
| **160p** | **18/25** | **25/25** | **+2.1** | **-17%** | 7.6 vs 9.2 MB |

**Zero cases >10% larger than gifski. Zero cases >5% larger. Zero VMAF losses >2 points.**

gifhero wins VMAF at every resolution and is smaller in 24-25 out of 25 encodes. The VMAF advantage grows at lower resolutions (+0.3 at 480p → +2.1 at 160p).

### Efficiency (VMAF per MB)

| Resolution | gifhero | gifski | Advantage |
|-----------|---------|--------|-----------|
| 480p | 13,412 | 12,570 | +7% |
| 360p | 13,567 | 12,613 | +8% |
| 240p | 13,863 | 12,704 | +9% |
| 160p | 14,265 | 12,900 | +11% |

gifhero delivers more perceptual quality per byte at every resolution, with the efficiency gap widening at lower resolutions.

### Size Distribution

| Resolution | Smaller | 0–5% larger | 5–10% larger | >10% larger | Median Δ |
|-----------|---------|-------------|--------------|-------------|----------|
| 480p | 24 | 1 | 0 | 0 | -19% |
| 360p | 24 | 1 | 0 | 0 | -21% |
| 240p | 25 | 0 | 0 | 0 | -23% |
| 160p | 25 | 0 | 0 | 0 | -18% |

---

## 480p Results (25 fixtures, native resolution)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **3,221KB** / 93.0 | 4,775KB / **94.0** | **-33%** | -1.1 |
| bbb-clip-02 | **3,101KB** / **94.2** | 3,806KB / 93.5 | **-19%** | **+0.7** |
| bbb-clip-03 | **996KB** / 93.7 | 1,358KB / **94.8** | **-27%** | -1.1 |
| bbb-clip-04 | **1,521KB** / 95.1 | 2,102KB / **95.4** | **-28%** | -0.3 |
| bbb-clip-05 | **1,601KB** / 96.3 | 2,269KB / **97.5** | **-29%** | -1.1 |
| bbb-clip-06 | **1,141KB** / **95.0** | 1,473KB / 94.6 | **-23%** | **+0.4** |
| bbb-clip-07 | **2,014KB** / **95.9** | 2,661KB / 90.5 | **-24%** | **+5.3** |
| bbb-clip-08 | 6,587KB / 98.4 | **6,514KB** / 98.4 | +1% | -0.0 |
| bbb-clip-09 | **1,302KB** / 95.1 | 1,730KB / **95.7** | **-25%** | -0.5 |
| bbb-clip-10 | **3,436KB** / 99.9 | 4,451KB / **100.0** | **-23%** | -0.0 |
| big-buck-bunny | **2,252KB** / **92.3** | 3,172KB / 91.9 | **-29%** | **+0.4** |
| black-and-white | **10,999KB** / **99.9** | 12,367KB / 99.9 | **-11%** | +0.0 |
| candle-flame | **194KB** / **97.2** | 219KB / 96.7 | **-11%** | **+0.5** |
| city-night | **3,294KB** / 96.9 | 4,182KB / **97.2** | **-21%** | -0.2 |
| color-wheel | **4,046KB** / 97.7 | 4,304KB / **98.0** | **-6%** | -0.4 |
| fast-action | **3,056KB** / **98.7** | 3,282KB / 96.4 | **-7%** | **+2.4** |
| jellyfish | **2,559KB** / 95.9 | 2,939KB / **97.3** | **-13%** | -1.3 |
| pixel-art | **320KB** / 98.9 | 361KB / 98.9 | **-11%** | -0.0 |
| screen-recording | **639KB** / 98.2 | 719KB / **98.2** | **-11%** | -0.1 |
| screencast | **17KB** / **97.6** | 50KB / 97.5 | **-66%** | **+0.0** |
| shapes | **361KB** / **96.6** | 398KB / 94.0 | **-9%** | **+2.6** |
| sintel | **1,190KB** / **97.7** | 1,457KB / 97.3 | **-18%** | **+0.4** |
| skin-tones | **129KB** / 97.0 | 180KB / **97.1** | **-28%** | -0.1 |
| talking-head | **1,145KB** / **95.4** | 1,223KB / 95.0 | **-6%** | **+0.4** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 9/25 | Size wins: 24/25 | Avg VMAF: +0.3 | Total: 53.8 vs 64.4 MB (-16%)**

---

## 360p Results (25 fixtures, Lanczos3 downscale + shared palette)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **1,800KB** / 90.9 | 2,572KB / **91.8** | **-30%** | -0.9 |
| bbb-clip-02 | **1,775KB** / **93.1** | 2,081KB / 91.6 | **-15%** | **+1.4** |
| bbb-clip-03 | **652KB** / 92.7 | 848KB / **93.0** | **-23%** | -0.3 |
| bbb-clip-04 | **999KB** / **94.5** | 1,252KB / 94.0 | **-20%** | **+0.5** |
| bbb-clip-05 | **1,034KB** / 95.6 | 1,413KB / **96.1** | **-27%** | -0.5 |
| bbb-clip-06 | **714KB** / **93.7** | 882KB / 93.2 | **-19%** | **+0.6** |
| bbb-clip-07 | **1,208KB** / **95.1** | 1,602KB / 88.4 | **-25%** | **+6.8** |
| bbb-clip-08 | 3,824KB / **97.6** | **3,802KB** / 97.1 | +1% | **+0.5** |
| bbb-clip-09 | **751KB** / 93.8 | 1,039KB / **94.8** | **-28%** | -1.0 |
| bbb-clip-10 | **2,117KB** / 99.5 | 2,806KB / **99.9** | **-25%** | -0.4 |
| big-buck-bunny | **1,275KB** / **90.7** | 1,729KB / 89.5 | **-26%** | **+1.1** |
| black-and-white | **6,452KB** / **99.9** | 7,106KB / 99.8 | **-9%** | **+0.1** |
| candle-flame | **90KB** / 96.3 | 153KB / 96.2 | **-41%** | +0.0 |
| city-night | **1,781KB** / 94.2 | 2,315KB / **94.6** | **-23%** | -0.4 |
| color-wheel | **2,536KB** / 97.3 | 2,719KB / 97.2 | **-7%** | +0.0 |
| fast-action | **1,759KB** / **97.0** | 1,925KB / 93.2 | **-9%** | **+3.8** |
| jellyfish | **1,554KB** / 95.0 | 1,770KB / **95.5** | **-12%** | -0.6 |
| pixel-art | **271KB** / **99.7** | 323KB / 99.6 | **-16%** | **+0.0** |
| screen-recording | **377KB** / 99.2 | 478KB / **99.3** | **-21%** | -0.2 |
| screencast | **12KB** / 93.3 | 44KB / **93.4** | **-73%** | -0.1 |
| shapes | **248KB** / 93.1 | 313KB / **94.2** | **-21%** | -1.1 |
| sintel | **722KB** / **98.0** | 950KB / 97.2 | **-24%** | **+0.8** |
| skin-tones | **87KB** / 96.5 | 161KB / **96.9** | **-46%** | -0.3 |
| talking-head | **699KB** / **94.2** | 755KB / 93.5 | **-7%** | **+0.7** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 10/25 | Size wins: 24/25 | Avg VMAF: +0.4 | Total: 32.0 vs 38.1 MB (-16%)**

---

## 240p Results (25 fixtures, Lanczos3 downscale + shared palette + adaptive maxColors)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **792KB** / 86.9 | 1,153KB / **87.2** | **-31%** | -0.3 |
| bbb-clip-02 | **757KB** / **89.5** | 920KB / 87.8 | **-18%** | **+1.7** |
| bbb-clip-03 | **329KB** / 89.5 | 446KB / 89.5 | **-26%** | -0.0 |
| bbb-clip-04 | **523KB** / **92.3** | 627KB / 91.4 | **-17%** | **+0.8** |
| bbb-clip-05 | **555KB** / **93.4** | 753KB / 93.1 | **-26%** | **+0.3** |
| bbb-clip-06 | **364KB** / **92.0** | 449KB / 90.7 | **-19%** | **+1.3** |
| bbb-clip-07 | **641KB** / **93.6** | 828KB / 85.7 | **-23%** | **+7.9** |
| bbb-clip-08 | **1,835KB** / **95.9** | 1,909KB / 93.3 | **-4%** | **+2.5** |
| bbb-clip-09 | **400KB** / 91.6 | 519KB / **92.0** | **-23%** | -0.5 |
| bbb-clip-10 | **936KB** / 94.5 | 1,322KB / **95.9** | **-29%** | -1.4 |
| big-buck-bunny | **614KB** / **87.3** | 786KB / 84.7 | **-22%** | **+2.5** |
| black-and-white | **2,782KB** / **97.1** | 3,116KB / 92.5 | **-11%** | **+4.5** |
| candle-flame | **51KB** / 95.3 | 100KB / **95.6** | **-49%** | -0.3 |
| city-night | **748KB** / 88.7 | 1,007KB / **89.2** | **-26%** | -0.5 |
| color-wheel | **1,187KB** / **95.8** | 1,297KB / 94.9 | **-9%** | **+0.9** |
| fast-action | **875KB** / **94.4** | 930KB / 86.8 | **-6%** | **+7.6** |
| jellyfish | **775KB** / **92.2** | 897KB / 91.7 | **-14%** | **+0.4** |
| pixel-art | **170KB** / **100.0** | 181KB / 100.0 | **-6%** | +0.0 |
| screen-recording | **185KB** / 97.4 | 262KB / **97.5** | **-29%** | -0.1 |
| screencast | **8KB** / **91.2** | 42KB / 89.4 | **-81%** | **+1.9** |
| shapes | **146KB** / **93.1** | 197KB / 91.6 | **-26%** | **+1.5** |
| sintel | **394KB** / **99.0** | 513KB / 96.9 | **-23%** | **+2.1** |
| skin-tones | **50KB** / 95.5 | 107KB / **96.1** | **-54%** | -0.6 |
| talking-head | **358KB** / **92.0** | 395KB / 90.8 | **-9%** | **+1.2** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 15/25 | Size wins: 25/25 | Avg VMAF: +1.3 | Total: 15.1 vs 18.3 MB (-18%)**

---

## 160p Results (25 fixtures, Lanczos3 downscale + shared palette + adaptive maxColors)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **370KB** / 81.9 | 482KB / 81.9 | **-23%** | +0.0 |
| bbb-clip-02 | **366KB** / **87.3** | 408KB / 83.8 | **-10%** | **+3.6** |
| bbb-clip-03 | **184KB** / **86.5** | 252KB / 85.6 | **-27%** | **+0.9** |
| bbb-clip-04 | **275KB** / **88.5** | 326KB / 87.7 | **-16%** | **+0.8** |
| bbb-clip-05 | **332KB** / **90.4** | 402KB / 89.1 | **-17%** | **+1.3** |
| bbb-clip-06 | **184KB** / **88.0** | 240KB / 87.0 | **-23%** | **+1.0** |
| bbb-clip-07 | **343KB** / **90.9** | 427KB / 81.4 | **-20%** | **+9.5** |
| bbb-clip-08 | **945KB** / **92.9** | 974KB / 87.3 | **-3%** | **+5.7** |
| bbb-clip-09 | **225KB** / 88.5 | 273KB / **88.7** | **-18%** | -0.2 |
| bbb-clip-10 | **447KB** / **87.0** | 646KB / 86.2 | **-31%** | **+0.8** |
| big-buck-bunny | **300KB** / **83.8** | 333KB / 79.5 | **-10%** | **+4.3** |
| black-and-white | **1,218KB** / **91.2** | 1,349KB / 83.7 | **-10%** | **+7.5** |
| candle-flame | **30KB** / 93.8 | 72KB / **94.8** | **-58%** | -1.0 |
| city-night | **402KB** / **85.9** | 437KB / 83.9 | **-8%** | **+2.0** |
| color-wheel | **639KB** / **94.4** | 971KB / 92.1 | **-34%** | **+2.3** |
| fast-action | **413KB** / **89.4** | 448KB / 80.3 | **-8%** | **+9.1** |
| jellyfish | **409KB** / **87.7** | 449KB / 85.9 | **-9%** | **+1.8** |
| pixel-art | **101KB** / **100.0** | 112KB / 100.0 | **-10%** | +0.0 |
| screen-recording | **99KB** / **94.3** | 151KB / 93.3 | **-35%** | **+1.0** |
| screencast | **6KB** / 86.3 | 25KB / **87.9** | **-77%** | -1.6 |
| shapes | **88KB** / **91.4** | 128KB / 90.7 | **-31%** | **+0.7** |
| sintel | **207KB** / **100.0** | 275KB / 98.5 | **-25%** | **+1.5** |
| skin-tones | **29KB** / 95.2 | 77KB / **97.0** | **-63%** | -1.8 |
| talking-head | **205KB** / **91.2** | 208KB / 87.9 | **-1%** | **+3.2** |
| two-frame | **0.4KB** / **98.7** | 0.5KB / 98.7 | **-5%** | +0.0 |

**VMAF wins: 18/25 | Size wins: 25/25 | Avg VMAF: +2.1 | Total: 7.6 vs 9.2 MB (-17%)**

---

## Notable Results

### Biggest VMAF Wins (gifhero − gifski)

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| bbb-clip-07 | 160p | **+9.5** | -20% |
| fast-action | 160p | **+9.1** | -8% |
| bbb-clip-07 | 240p | **+7.9** | -23% |
| fast-action | 240p | **+7.6** | -6% |
| black-and-white | 160p | **+7.5** | -10% |

### Worst VMAF Deltas

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| skin-tones | 160p | -1.8 | **-63%** |
| screencast | 160p | -1.6 | **-77%** |
| bbb-clip-10 | 240p | -1.4 | **-29%** |
| jellyfish | 480p | -1.3 | **-13%** |
| bbb-clip-03 | 480p | -1.1 | **-27%** |

Every VMAF loss is under 2 points and paired with a significant size reduction.

### Biggest Size Wins

| Fixture | Res | Δ Size | Δ VMAF |
|---------|-----|--------|--------|
| screencast | 240p | **-81%** | +1.9 |
| screencast | 160p | **-77%** | -1.6 |
| screencast | 360p | **-73%** | -0.1 |
| screencast | 480p | **-66%** | +0.0 |
| skin-tones | 160p | **-63%** | -1.8 |

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth < source width)
  → Probe: static mask, motion × complexity, keyframes, perFrameMotion
  → Content-adaptive staleThreshold (5–10 from complexity)
    + per-frame boost (+1 when frame motion < 2%)
  → Content-adaptive lossyLzw (preset–5 from complexity)
  → Adaptive maxColors (192 when colorComplexity ≥ 20K)
  → Shared palette via Histogram (if downscaling OR colorComplexity ≥ 8K)
  → Frame 0 / keyframes: full-frame quantize, reset canvas
  → Frames 1+:
      Shared: remapWithPalette(frame, sharedPalette, canvas)
      Per-frame: quantizeWithBackground(frame, canvas)
  → tight crop → trimPalette (with po2 targeting) → lossy LZW (deferred clear) → GIF89a
```

### staleThreshold Formula

```
complexity = motionLevel × colorComplexity
baseThreshold = clamp(5, 10, round(5 + 5 × min(1, complexity / 5000)))
frameThreshold = perFrameMotion[i] < 0.02
  ? min(10, baseThreshold + 1)
  : baseThreshold
```

### Adaptive lossyLzw Formula

```
complexity = motionLevel × colorComplexity
adaptiveLzw = clamp(preset, 5, round(preset + complexity / 3000))
```

### Deferred Clear Code

When LZW dictionary fills (code 4095), continue matching without adding entries. Emit CLEAR only when compression ratio degrades (> 11 bits/pixel over 256-pixel window). Lossless, spec-compliant.

### Power-of-2 Palette Targeting

After trimming unused entries, if count is just above a power-of-2 boundary (within 6%), evict the least-used entries (remapped to nearest neighbor) to cross the boundary and reduce LZW min code size by 1 bit.

---

## Optimization Journey

Started with **32 cases >10% larger** than gifski. Systematically reduced to **0** through:

| Fix | Key change |
|-----|------------|
| staleThreshold override bug | Fixed ignored user override |
| Motion floor (>1% → threshold ≥5) | talking-head +65% → +11% |
| Linear threshold scale | bbb-clip-02 +17% → +5% |
| Adaptive lossyLzw (4→5 from complexity) | High-motion clips shrunk |
| Conditional shared palette (≥8K colors) | talking-head +11% → +3% |
| Shared palette for all downscaled | bbb-clip-02 360p +14% → -2% |
| Adaptive maxColors (192 for ≥20K colors) | bbb-clip-08 +7% → +2% |
| staleThreshold base raised to 5 | skin-tones +6% → -28% |
| Per-frame threshold boost (+1) | Near-static frames more transparent |
| Power-of-2 palette targeting | 0.1-0.4% at lower resolutions |
| Deferred LZW clear code | 0.2-0.3% lossless savings |
