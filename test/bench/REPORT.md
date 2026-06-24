# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-24
**Commit:** f9b1ef0
**Fixtures:** 25 clips × 4 resolutions × 2 presets = 200 encodes per preset
**gifski:** default settings (quality 90)

### gifhero presets

| Preset | imagequant quality | Goal |
|--------|---|---|
| **quality** (q98) | 98 | Maximum VMAF and minimal posterization |
| **balanced** (q95, default) | 95 | Best compression with reduced posterization |

Both presets share: Floyd-Steinberg dithering, adaptive lossyLzw 4–5, conditional shared palette, Lanczos3 downscaling, keyframe detection, deferred LZW clear, power-of-2 palette targeting, motion-adjusted staleThreshold, noise-aware temporal denoiser (balanced only).

---

## Summary

### quality preset (q98)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|-------------|
| **480p** | **15/25** | **16/25** | **+0.5** | **-7%** (59.8 vs 64.4 MB) |
| **360p** | **18/25** | **18/25** | **+1.0** | **-5%** (36.2 vs 38.1 MB) |
| **240p** | **22/25** | **17/25** | **+2.2** | **-4%** (17.6 vs 18.3 MB) |
| **160p** | **21/25** | **17/25** | **+3.0** | **-4%** (8.8 vs 9.2 MB) |

**Zero VMAF losses >2 points.**

### balanced preset (q95)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|-------------|
| **480p** | **10/25** | **22/25** | **+0.1** | **-14%** (55.6 vs 64.4 MB) |
| **360p** | **11/25** | **23/25** | **+0.3** | **-14%** (32.7 vs 38.1 MB) |
| **240p** | **16/25** | **24/25** | **+1.3** | **-14%** (15.8 vs 18.3 MB) |
| **160p** | **18/25** | **24/25** | **+2.0** | **-14%** (7.9 vs 9.2 MB) |

**Zero VMAF losses >2 points.**

### Efficiency (VMAF per MB)

| Resolution | quality | balanced | gifski |
|-----------|---------|----------|--------|
| 480p | 13,397 (+7%) | 13,433 (+7%) | 12,570 |
| 360p | 13,413 (+6%) | 13,516 (+7%) | 12,613 |
| 240p | 13,599 (+7%) | 13,747 (+8%) | 12,704 |
| 160p | 13,909 (+8%) | 14,113 (+9%) | 12,900 |

### Size Distribution

| Preset | Res | Smaller | 0–5% | 5–10% | >10% | Median Δ |
|--------|-----|---------|------|-------|------|----------|
| quality | 480p | 16 | 4 | 3 | 2 | -5% |
| quality | 360p | 18 | 3 | 3 | 1 | -5% |
| quality | 240p | 17 | 5 | 1 | 2 | -6% |
| quality | 160p | 17 | 3 | 0 | 5 | -8% |
| balanced | 480p | 22 | 2 | 0 | 1 | -14% |
| balanced | 360p | 23 | 1 | 0 | 1 | -19% |
| balanced | 240p | 24 | 0 | 0 | 1 | -19% |
| balanced | 160p | 24 | 0 | 0 | 1 | -19% |

---

## 480p Results

| Fixture | quality (q98) | balanced (q95) | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 3,289KB / 92.8 | **3,105KB** / 92.6 | 4,775KB / **94.0** |
| bbb-clip-02 | 3,232KB / **93.7** | **2,746KB** / 92.3 | 3,806KB / 93.5 |
| bbb-clip-03 | 1,087KB / **93.8** | **996KB** / 93.7 | 1,358KB / 94.8 |
| bbb-clip-04 | 1,680KB / **95.7** | **1,372KB** / 94.3 | 2,102KB / 95.4 |
| bbb-clip-05 | 1,624KB / 96.3 | **1,565KB** / 96.2 | 2,269KB / **97.5** |
| bbb-clip-06 | 1,261KB / **95.1** | **1,141KB** / 95.0 | 1,473KB / 94.6 |
| bbb-clip-07 | 2,167KB / **95.8** | **2,036KB** / 94.8 | 2,661KB / 90.5 |
| bbb-clip-08 | 6,860KB / **98.6** | **6,653KB** / 98.5 | **6,514KB** / 98.4 |
| bbb-clip-09 | 1,322KB / **95.3** | **1,302KB** / 95.1 | 1,730KB / 95.7 |
| bbb-clip-10 | 4,226KB / **100.0** | **3,869KB** / 100.0 | 4,451KB / 100.0 |
| big-buck-bunny | 2,292KB / **92.6** | **2,194KB** / 92.0 | 3,172KB / 91.9 |
| black-and-white | 12,979KB / **99.9** | **12,040KB** / 99.9 | 12,367KB / 99.9 |
| candle-flame | 258KB / **97.4** | **227KB** / 97.3 | **219KB** / 96.7 |
| city-night | 3,353KB / **97.2** | **3,251KB** / 96.8 | 4,182KB / 97.2 |
| color-wheel | 4,237KB / **98.2** | **4,046KB** / 97.7 | 4,304KB / 98.0 |
| fast-action | 4,005KB / **99.5** | **3,836KB** / 99.5 | **3,282KB** / 96.4 |
| jellyfish | 2,782KB / **96.9** | **2,640KB** / 96.4 | 2,939KB / **97.3** |
| pixel-art | 336KB / **99.0** | **329KB** / 99.0 | 361KB / 98.9 |
| screen-recording | 752KB / **98.4** | **689KB** / 98.3 | 719KB / 98.2 |
| screencast | 17KB / **97.6** | **15KB** / 97.5 | 50KB / 97.5 |
| shapes | 414KB / **98.2** | **344KB** / 97.0 | 398KB / 94.0 |
| sintel | 1,573KB / **98.5** | **1,260KB** / 97.4 | 1,457KB / 97.3 |
| skin-tones | 182KB / **97.2** | **133KB** / 97.2 | 180KB / 97.1 |
| talking-head | 1,295KB / **95.7** | **1,121KB** / 94.8 | 1,223KB / 95.0 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## 360p Results

| Fixture | quality (q98) | balanced (q95) | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 1,839KB / **91.2** | **1,600KB** / 90.0 | 2,572KB / 91.8 |
| bbb-clip-02 | 1,897KB / **93.2** | **1,533KB** / 91.2 | 2,081KB / 91.6 |
| bbb-clip-03 | 692KB / **93.2** | **652KB** / 92.7 | 848KB / 93.0 |
| bbb-clip-04 | 1,048KB / **94.8** | **899KB** / 93.8 | 1,252KB / 94.0 |
| bbb-clip-05 | 1,064KB / 95.6 | **1,008KB** / 95.5 | 1,413KB / **96.1** |
| bbb-clip-06 | 846KB / **94.5** | **714KB** / 93.7 | 882KB / 93.2 |
| bbb-clip-07 | 1,302KB / **95.0** | **1,214KB** / 93.4 | 1,602KB / 88.4 |
| bbb-clip-08 | 3,998KB / **98.0** | **3,875KB** / 97.9 | **3,802KB** / 97.1 |
| bbb-clip-09 | 806KB / **94.7** | **705KB** / 93.1 | 1,039KB / 94.8 |
| bbb-clip-10 | 2,785KB / **99.9** | **2,373KB** / 99.8 | 2,806KB / 99.9 |
| big-buck-bunny | 1,299KB / **90.6** | **1,133KB** / 89.2 | 1,729KB / 89.5 |
| black-and-white | 7,676KB / **99.9** | **6,927KB** / 99.9 | 7,106KB / 99.8 |
| candle-flame | 160KB / **97.1** | **110KB** / 96.7 | 153KB / 96.2 |
| city-night | 1,812KB / 94.1 | **1,765KB** / **94.1** | 2,315KB / 94.6 |
| color-wheel | 2,664KB / **98.2** | **2,536KB** / 97.3 | 2,719KB / 97.2 |
| fast-action | 2,430KB / **99.0** | **2,267KB** / 98.4 | **1,925KB** / 93.2 |
| jellyfish | 1,692KB / **95.9** | **1,601KB** / 95.5 | 1,770KB / 95.5 |
| pixel-art | 318KB / **99.7** | **296KB** / 99.8 | 323KB / 99.6 |
| screen-recording | 489KB / **99.6** | **402KB** / 99.1 | 478KB / 99.3 |
| screencast | 18KB / **93.5** | **14KB** / 93.9 | 44KB / 93.4 |
| shapes | 272KB / **96.3** | **256KB** / 95.0 | 313KB / **94.2** |
| sintel | 986KB / **98.5** | **788KB** / 97.6 | 950KB / 97.2 |
| skin-tones | 141KB / **97.2** | **98KB** / 96.9 | 161KB / 96.9 |
| talking-head | 795KB / **95.1** | **681KB** / 94.2 | 755KB / 93.5 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## 240p Results

| Fixture | quality (q98) | balanced (q95) | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 858KB / **87.7** | **739KB** / 86.1 | 1,153KB / 87.2 |
| bbb-clip-02 | 865KB / **91.1** | **757KB** / 89.5 | 920KB / 87.8 |
| bbb-clip-03 | 378KB / **89.8** | **329KB** / 89.5 | 446KB / 89.5 |
| bbb-clip-04 | 569KB / **93.0** | **479KB** / 91.7 | 627KB / 91.4 |
| bbb-clip-05 | 580KB / **93.5** | **547KB** / 93.1 | 753KB / 93.1 |
| bbb-clip-06 | 420KB / **92.8** | **364KB** / 92.0 | 449KB / 90.7 |
| bbb-clip-07 | 696KB / **94.2** | **670KB** / 92.2 | 828KB / 85.7 |
| bbb-clip-08 | 1,961KB / **96.4** | **1,862KB** / 96.1 | 1,909KB / 93.3 |
| bbb-clip-09 | 441KB / **92.4** | **377KB** / 90.5 | 519KB / 92.0 |
| bbb-clip-10 | 1,350KB / **96.3** | **1,096KB** / 95.4 | 1,322KB / 95.9 |
| big-buck-bunny | 701KB / **88.1** | **576KB** / 86.4 | 786KB / 84.7 |
| black-and-white | 3,426KB / **99.2** | **3,077KB** / 98.0 | 3,116KB / 92.5 |
| candle-flame | 95KB / **96.4** | **63KB** / 95.9 | 100KB / 95.6 |
| city-night | 767KB / 88.6 | **738KB** / **88.4** | 1,007KB / 89.2 |
| color-wheel | 1,291KB / **96.8** | **1,187KB** / 95.8 | 1,297KB / 94.9 |
| fast-action | 1,167KB / **95.9** | **1,136KB** / 95.8 | **930KB** / 86.8 |
| jellyfish | 842KB / **93.1** | **802KB** / 92.8 | 897KB / 91.7 |
| pixel-art | 205KB / **100.0** | **180KB** / 100.0 | 181KB / 100.0 |
| screen-recording | 268KB / **97.7** | **215KB** / 97.2 | 262KB / 97.5 |
| screencast | 13KB / **90.8** | **10KB** / 89.4 | 42KB / 89.4 |
| shapes | 165KB / **95.7** | **158KB** / 93.4 | 197KB / 91.6 |
| sintel | 522KB / **98.9** | **441KB** / 98.6 | 513KB / 96.9 |
| skin-tones | 87KB / **96.7** | **59KB** / 96.3 | 107KB / 96.1 |
| talking-head | 405KB / **93.3** | **353KB** / 92.0 | 395KB / 90.8 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## 160p Results

| Fixture | quality (q98) | balanced (q95) | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 402KB / **82.9** | **341KB** / 81.0 | 482KB / 81.9 |
| bbb-clip-02 | 413KB / **89.0** | **366KB** / 87.3 | 408KB / 83.8 |
| bbb-clip-03 | 199KB / **86.8** | **184KB** / 86.5 | 252KB / 85.6 |
| bbb-clip-04 | 300KB / **89.4** | **257KB** / 88.0 | 326KB / 87.7 |
| bbb-clip-05 | 332KB / **90.2** | **325KB** / 90.0 | 402KB / 89.1 |
| bbb-clip-06 | 215KB / **88.9** | **184KB** / 88.0 | 240KB / 87.0 |
| bbb-clip-07 | 373KB / **91.5** | **346KB** / 88.9 | 427KB / 81.4 |
| bbb-clip-08 | 973KB / **93.8** | **969KB** / 93.4 | 974KB / 87.3 |
| bbb-clip-09 | 236KB / **88.9** | **213KB** / 87.3 | 273KB / 88.7 |
| bbb-clip-10 | 677KB / **89.1** | **528KB** / 88.0 | 646KB / 86.2 |
| big-buck-bunny | 332KB / **84.8** | **277KB** / 82.9 | 333KB / 79.5 |
| black-and-white | 1,514KB / **93.2** | **1,337KB** / 91.5 | 1,349KB / 83.7 |
| candle-flame | 50KB / **95.4** | **35KB** / 94.5 | 72KB / **94.8** |
| city-night | 402KB / **85.9** | **366KB** / 84.4 | 437KB / 83.9 |
| color-wheel | 639KB / **94.4** | 639KB / 94.4 | 971KB / 92.1 |
| fast-action | 573KB / **92.7** | **528KB** / 90.5 | **448KB** / 80.3 |
| jellyfish | 425KB / **88.7** | **423KB** / 88.6 | 449KB / 85.9 |
| pixel-art | 123KB / **100.0** | **110KB** / 100.0 | 112KB / 100.0 |
| screen-recording | 154KB / **93.9** | **116KB** / 93.7 | 151KB / 93.3 |
| screencast | 9KB / **87.9** | **7KB** / 86.5 | 25KB / 87.9 |
| shapes | 104KB / **93.7** | **100KB** / 91.9 | 128KB / 90.7 |
| sintel | 310KB / **100.0** | **235KB** / 100.0 | 275KB / 98.5 |
| skin-tones | 58KB / **96.5** | **37KB** / 96.1 | 77KB / **97.0** |
| talking-head | 233KB / **92.0** | **202KB** / 90.8 | 208KB / 87.9 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth < source width)
  → Temporal denoise (balanced only, noise-aware gate)
  → Probe: static mask, motion × complexity, keyframes, perFrameMotion
  → Content-adaptive staleThreshold (motion-adjusted)
      quality: base 4, motionFloor 4/5, motion penalty
      balanced: base 5, per-frame boost, motion penalty
  → Content-adaptive lossyLzw (preset–5 from complexity)
  → Adaptive maxColors
      quality: 224 when colorComplexity ≥ 30K
      balanced: 192 when colorComplexity ≥ 20K
  → Shared palette via Histogram (if downscaling OR colorComplexity ≥ 8K)
  → Frame 0 / keyframes: full-frame quantize, reset canvas
  → Frames 1+:
      Shared: remapWithPalette(frame, sharedPalette, canvas)
      Per-frame: quantizeWithBackground(frame, canvas)
  → Post-quantization transparency recovery
  → tight crop → trimPalette (with po2 targeting) → lossy LZW (deferred clear) → GIF89a
```
