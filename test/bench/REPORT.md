# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-24
**Fixtures:** 25 clips × 4 resolutions × 2 presets = 200 encodes per preset, compared to gifski
**gifski:** default settings (quality 90)

### gifhero presets

| Preset | Goal | Key differences |
|--------|------|-----------------|
| **quality** | Maximum VMAF, never >5% larger than gifski | Lower staleThreshold (base 4), full 256-color palettes, no per-frame threshold boost |
| **balanced** (default) | Maximum compression | Higher staleThreshold (base 5), adaptive maxColors (192 at ≥20K), per-frame threshold boost on near-static frames |

Both presets share: imagequant q90 speed 1, Floyd-Steinberg dithering, adaptive lossyLzw 4–5, conditional shared palette, Lanczos3 downscaling, keyframe detection, deferred LZW clear, power-of-2 palette targeting.

---

## Summary

### quality preset (VMAF-optimized)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|-------------|
| **480p** | **12/25** | **23/25** | **+0.4** | **-14%** (55.4 vs 64.4 MB) |
| **360p** | **14/25** | **23/25** | **+0.7** | **-14%** (33.0 vs 38.1 MB) |
| **240p** | **18/25** | **24/25** | **+1.6** | **-13%** (15.9 vs 18.3 MB) |
| **160p** | **21/25** | **25/25** | **+2.5** | **-15%** (7.8 vs 9.2 MB) |

**Zero cases >5% larger. Zero VMAF losses >2 points.**

### balanced preset (size-optimized)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|-------------|
| **480p** | **9/25** | **24/25** | **+0.3** | **-16%** (53.8 vs 64.4 MB) |
| **360p** | **10/25** | **24/25** | **+0.4** | **-16%** (32.0 vs 38.1 MB) |
| **240p** | **15/25** | **25/25** | **+1.3** | **-18%** (15.1 vs 18.3 MB) |
| **160p** | **18/25** | **25/25** | **+2.1** | **-17%** (7.6 vs 9.2 MB) |

**Zero cases >5% larger. Zero VMAF losses >2 points.**

### Efficiency (VMAF per MB)

| Resolution | quality | balanced | gifski |
|-----------|---------|----------|--------|
| 480p | 13,369 (+6%) | 13,412 (+7%) | 12,570 |
| 360p | 13,535 (+7%) | 13,567 (+8%) | 12,613 |
| 240p | 13,815 (+9%) | 13,863 (+9%) | 12,704 |
| 160p | 14,215 (+10%) | 14,265 (+11%) | 12,900 |

Both presets deliver more perceptual quality per byte than gifski at every resolution.

### Size Distribution

| Preset | Res | Smaller | 0–5% | 5–10% | >10% | Median Δ |
|--------|-----|---------|------|-------|------|----------|
| quality | 480p | 23 | 2 | 0 | 0 | -11% |
| quality | 360p | 23 | 2 | 0 | 0 | -18% |
| quality | 240p | 24 | 1 | 0 | 0 | -15% |
| quality | 160p | 25 | 0 | 0 | 0 | -16% |
| balanced | 480p | 24 | 1 | 0 | 0 | -19% |
| balanced | 360p | 24 | 1 | 0 | 0 | -21% |
| balanced | 240p | 25 | 0 | 0 | 0 | -23% |
| balanced | 160p | 25 | 0 | 0 | 0 | -18% |

---

## 480p Results

| Fixture | quality | balanced | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 3,289KB / 92.8 | **3,221KB** / 93.0 | 4,775KB / **94.0** |
| bbb-clip-02 | 3,232KB / 93.7 | **3,101KB** / **94.2** | 3,806KB / 93.5 |
| bbb-clip-03 | 1,087KB / **93.8** | **996KB** / 93.7 | 1,358KB / 94.8 |
| bbb-clip-04 | 1,680KB / **95.7** | **1,521KB** / 95.1 | 2,102KB / 95.4 |
| bbb-clip-05 | 1,624KB / 96.3 | **1,601KB** / 96.3 | 2,269KB / **97.5** |
| bbb-clip-06 | 1,261KB / **95.1** | **1,141KB** / 95.0 | 1,473KB / 94.6 |
| bbb-clip-07 | 2,067KB / 95.8 | **2,014KB** / **95.9** | 2,661KB / 90.5 |
| bbb-clip-08 | 6,766KB / 98.4 | **6,587KB** / 98.4 | **6,514KB** / 98.4 |
| bbb-clip-09 | 1,322KB / **95.3** | **1,302KB** / 95.1 | 1,730KB / 95.7 |
| bbb-clip-10 | 3,481KB / **99.9** | **3,436KB** / 99.9 | 4,451KB / **100.0** |
| big-buck-bunny | 2,292KB / **92.6** | **2,252KB** / 92.3 | 3,172KB / 91.9 |
| black-and-white | 10,999KB / **99.9** | 10,999KB / 99.9 | 12,367KB / 99.9 |
| candle-flame | 201KB / **97.3** | **194KB** / 97.2 | 219KB / 96.7 |
| city-night | 3,353KB / **97.2** | **3,294KB** / 96.9 | 4,182KB / 97.2 |
| color-wheel | 4,237KB / **98.2** | **4,046KB** / 97.7 | 4,304KB / 98.0 |
| fast-action | 3,056KB / **98.7** | 3,056KB / 98.7 | 3,282KB / 96.4 |
| jellyfish | 2,678KB / **96.4** | **2,559KB** / 95.9 | 2,939KB / **97.3** |
| pixel-art | 320KB / **98.9** | 320KB / 98.9 | 361KB / 98.9 |
| screen-recording | 639KB / **98.2** | 639KB / 98.2 | 719KB / 98.2 |
| screencast | 20KB / 97.5 | **17KB** / **97.6** | 50KB / 97.5 |
| shapes | 361KB / **96.6** | 361KB / 96.6 | 398KB / 94.0 |
| sintel | 1,305KB / **98.3** | **1,190KB** / 97.7 | 1,457KB / 97.3 |
| skin-tones | 164KB / **97.2** | **129KB** / 97.0 | 180KB / 97.1 |
| talking-head | 1,255KB / **96.0** | **1,145KB** / 95.4 | 1,223KB / 95.0 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## 360p Results

| Fixture | quality | balanced | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 1,839KB / **91.2** | **1,800KB** / 90.9 | 2,572KB / 91.8 |
| bbb-clip-02 | 1,897KB / **93.2** | **1,775KB** / 93.1 | 2,081KB / 91.6 |
| bbb-clip-03 | 692KB / **93.2** | **652KB** / 92.7 | 848KB / 93.0 |
| bbb-clip-04 | 1,048KB / **94.8** | **999KB** / 94.5 | 1,252KB / 94.0 |
| bbb-clip-05 | 1,064KB / 95.6 | **1,034KB** / 95.6 | 1,413KB / **96.1** |
| bbb-clip-06 | 762KB / **94.1** | **714KB** / 93.7 | 882KB / 93.2 |
| bbb-clip-07 | 1,245KB / 95.0 | **1,208KB** / **95.1** | 1,602KB / 88.4 |
| bbb-clip-08 | 3,932KB / **97.7** | **3,824KB** / 97.6 | **3,802KB** / 97.1 |
| bbb-clip-09 | 806KB / **94.7** | **751KB** / 93.8 | 1,039KB / 94.8 |
| bbb-clip-10 | 2,117KB / 99.5 | 2,117KB / 99.5 | 2,806KB / **99.9** |
| big-buck-bunny | 1,299KB / 90.6 | **1,275KB** / **90.7** | 1,729KB / 89.5 |
| black-and-white | 6,452KB / **99.9** | 6,452KB / 99.9 | 7,106KB / 99.8 |
| candle-flame | 93KB / **96.3** | **90KB** / 96.3 | 153KB / 96.2 |
| city-night | 1,812KB / 94.1 | **1,781KB** / **94.2** | 2,315KB / 94.6 |
| color-wheel | 2,664KB / **98.2** | **2,536KB** / 97.3 | 2,719KB / 97.2 |
| fast-action | 1,847KB / **97.8** | **1,759KB** / 97.0 | 1,925KB / 93.2 |
| jellyfish | 1,632KB / **95.3** | **1,554KB** / 95.0 | 1,770KB / 95.5 |
| pixel-art | 271KB / **99.7** | 271KB / 99.7 | 323KB / 99.6 |
| screen-recording | 377KB / 99.2 | 377KB / 99.2 | 478KB / **99.3** |
| screencast | 13KB / **93.7** | **12KB** / 93.3 | 44KB / 93.4 |
| shapes | 248KB / 93.1 | 248KB / 93.1 | 313KB / **94.2** |
| sintel | 777KB / **98.6** | **722KB** / 98.0 | 950KB / 97.2 |
| skin-tones | 102KB / 96.7 | **87KB** / 96.5 | 161KB / **96.9** |
| talking-head | 766KB / **94.9** | **699KB** / 94.2 | 755KB / 93.5 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## 240p Results

| Fixture | quality | balanced | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 858KB / **87.7** | **792KB** / 86.9 | 1,153KB / 87.2 |
| bbb-clip-02 | 865KB / **91.1** | **757KB** / 89.5 | 920KB / 87.8 |
| bbb-clip-03 | 378KB / **89.8** | **329KB** / 89.5 | 446KB / 89.5 |
| bbb-clip-04 | 569KB / **93.0** | **523KB** / 92.3 | 627KB / 91.4 |
| bbb-clip-05 | 580KB / **93.5** | **555KB** / 93.4 | 753KB / 93.1 |
| bbb-clip-06 | 384KB / **92.4** | **364KB** / 92.0 | 449KB / 90.7 |
| bbb-clip-07 | 664KB / **94.2** | **641KB** / 93.6 | 828KB / 85.7 |
| bbb-clip-08 | 1,922KB / **96.0** | **1,835KB** / 95.9 | 1,909KB / 93.3 |
| bbb-clip-09 | 441KB / **92.4** | **400KB** / 91.6 | 519KB / 92.0 |
| bbb-clip-10 | 950KB / 94.7 | **936KB** / 94.5 | 1,322KB / **95.9** |
| big-buck-bunny | 701KB / **88.1** | **614KB** / 87.3 | 786KB / 84.7 |
| black-and-white | 2,782KB / **97.1** | 2,782KB / 97.1 | 3,116KB / 92.5 |
| candle-flame | 52KB / 95.3 | **51KB** / 95.3 | 100KB / **95.6** |
| city-night | 767KB / 88.6 | **748KB** / **88.7** | 1,007KB / 89.2 |
| color-wheel | 1,291KB / **96.8** | **1,187KB** / 95.8 | 1,297KB / 94.9 |
| fast-action | 875KB / **94.4** | 875KB / 94.4 | 930KB / 86.8 |
| jellyfish | 812KB / **92.4** | **775KB** / 92.2 | 897KB / 91.7 |
| pixel-art | 170KB / **100.0** | 170KB / 100.0 | 181KB / 100.0 |
| screen-recording | 185KB / 97.4 | 185KB / 97.4 | 262KB / **97.5** |
| screencast | 8KB / 90.3 | **8KB** / **91.2** | 42KB / 89.4 |
| shapes | 146KB / **93.1** | 146KB / 93.1 | 197KB / 91.6 |
| sintel | 394KB / **99.0** | 394KB / 99.0 | 513KB / 96.9 |
| skin-tones | 60KB / **95.7** | **50KB** / 95.5 | 107KB / 96.1 |
| talking-head | 389KB / **92.7** | **358KB** / 92.0 | 395KB / 90.8 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## 160p Results

| Fixture | quality | balanced | gifski |
|---------|---------|----------|--------|
| bbb-clip-01 | 402KB / **82.9** | **370KB** / 81.9 | 482KB / 81.9 |
| bbb-clip-02 | 381KB / **88.1** | **366KB** / 87.3 | 408KB / 83.8 |
| bbb-clip-03 | 199KB / **86.8** | **184KB** / 86.5 | 252KB / 85.6 |
| bbb-clip-04 | 300KB / **89.4** | **275KB** / 88.5 | 326KB / 87.7 |
| bbb-clip-05 | 332KB / 90.2 | **332KB** / **90.4** | 402KB / 89.1 |
| bbb-clip-06 | 197KB / **88.4** | **184KB** / 88.0 | 240KB / 87.0 |
| bbb-clip-07 | 358KB / **91.4** | **343KB** / 90.9 | 427KB / 81.4 |
| bbb-clip-08 | 945KB / **92.9** | 945KB / 92.9 | 974KB / 87.3 |
| bbb-clip-09 | 236KB / **88.9** | **225KB** / 88.5 | 273KB / 88.7 |
| bbb-clip-10 | 456KB / **87.5** | **447KB** / 87.0 | 646KB / 86.2 |
| big-buck-bunny | 332KB / **84.8** | **300KB** / 83.8 | 333KB / 79.5 |
| black-and-white | 1,218KB / **91.2** | 1,218KB / 91.2 | 1,349KB / 83.7 |
| candle-flame | 31KB / 93.8 | **30KB** / 93.8 | 72KB / **94.8** |
| city-night | 402KB / **85.9** | 402KB / 85.9 | 437KB / 83.9 |
| color-wheel | 639KB / **94.4** | 639KB / 94.4 | 971KB / 92.1 |
| fast-action | 437KB / **90.8** | **413KB** / 89.4 | 448KB / 80.3 |
| jellyfish | 409KB / **87.7** | 409KB / 87.7 | 449KB / 85.9 |
| pixel-art | 101KB / **100.0** | 101KB / 100.0 | 112KB / 100.0 |
| screen-recording | 100KB / **94.3** | **99KB** / 94.3 | 151KB / 93.3 |
| screencast | 6KB / **88.3** | 6KB / 86.3 | 25KB / 87.9 |
| shapes | 88KB / **91.4** | 88KB / 91.4 | 128KB / 90.7 |
| sintel | 207KB / **100.0** | 207KB / 100.0 | 275KB / 98.5 |
| skin-tones | 34KB / **95.4** | **29KB** / 95.2 | 77KB / **97.0** |
| talking-head | 206KB / **91.2** | **205KB** / 91.2 | 208KB / 87.9 |
| two-frame | 0.4KB / **98.7** | 0.4KB / 98.7 | 0.5KB / 98.7 |

---

## Notable Results

### Biggest VMAF Wins (quality preset − gifski)

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| fast-action | 160p | **+10.5** | -3% |
| bbb-clip-07 | 160p | **+10.1** | -16% |
| bbb-clip-07 | 240p | **+8.5** | -20% |
| fast-action | 240p | **+7.6** | -6% |
| black-and-white | 160p | **+7.5** | -10% |

### Worst VMAF Deltas (quality preset − gifski)

| Fixture | Res | Δ VMAF | Δ Size |
|---------|-----|--------|--------|
| skin-tones | 160p | -1.6 | **-56%** |
| bbb-clip-05 | 480p | -1.2 | **-28%** |
| bbb-clip-01 | 480p | -1.2 | **-31%** |
| bbb-clip-10 | 240p | -1.2 | **-28%** |
| shapes | 360p | -1.1 | **-21%** |

Every VMAF loss is under 2 points and paired with a significant size reduction.

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth < source width)
  → Probe: static mask, motion × complexity, keyframes, perFrameMotion
  → Content-adaptive staleThreshold
      quality: base 4, motionFloor 4/5
      balanced: base 5, + per-frame boost (+1 on near-static frames)
  → Content-adaptive lossyLzw (preset–5 from complexity)
  → Adaptive maxColors
      quality: 224 when colorComplexity ≥ 30K
      balanced: 192 when colorComplexity ≥ 20K
  → Shared palette via Histogram (if downscaling OR colorComplexity ≥ 8K)
  → Frame 0 / keyframes: full-frame quantize, reset canvas
  → Frames 1+:
      Shared: remapWithPalette(frame, sharedPalette, canvas)
      Per-frame: quantizeWithBackground(frame, canvas)
  → tight crop → trimPalette (with po2 targeting) → lossy LZW (deferred clear) → GIF89a
```

### staleThreshold Formula

**quality:**
```
motionFloor = motionLevel > 1% ? 5 : 4
autoThreshold = clamp(motionFloor, 10, round(4 + 6 × min(1, complexity / 5000)))
```

**balanced:**
```
baseThreshold = clamp(5, 10, round(5 + 5 × min(1, complexity / 5000)))
frameThreshold = perFrameMotion[i] < 0.02 ? min(10, baseThreshold + 1) : baseThreshold
```

### Adaptive lossyLzw (both presets)

```
complexity = motionLevel × colorComplexity
adaptiveLzw = clamp(preset, 5, round(preset + complexity / 3000))
```

### Deferred Clear Code (both presets)

When LZW dictionary fills (code 4095), continue matching without adding entries. Emit CLEAR only when compression ratio degrades (> 11 bits/pixel over 256-pixel window). Lossless, spec-compliant.

### Power-of-2 Palette Targeting (both presets)

After trimming unused entries, if count is just above a power-of-2 boundary (within 6%), evict the least-used entries (remapped to nearest neighbor) to cross the boundary and reduce LZW min code size by 1 bit.
