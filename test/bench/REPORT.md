# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-23  
**Commit:** e9bf5ea  
**gifhero:** quality preset (imagequant q90 speed 1, lossyLzw 4, content-adaptive staleThreshold, keyframe detection, Lanczos3 downscaling, shared palette for ≥2× downscale)  
**gifski:** default settings (quality 90, built-in downscaler)  
**Fixtures:** 25 × 4 resolutions (480p, 360p, 240p, 160p) = 200 encodes per encoder

---

## Summary

gifhero wins VMAF at every resolution. The advantage grows as resolution decreases.

| Resolution | VMAF wins | Size wins | Avg VMAF Δ |
|-----------|-----------|-----------|------------|
| **480p** | **21/25** | 11/25 | **+1.3** |
| **360p** | **23/25** | 5/25 | **+2.0** |
| **240p** | **19/25** | 13/25 | **+2.6** |
| **160p** | **21/25** | 14/25 | **+3.5** |

---

## 480p (native resolution)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **4.3MB** / **94.7** | 4.7MB / 94.0 | **-9%** | **+0.7** |
| bbb-clip-02 | 4.4MB / **96.2** | **3.7MB** / 93.5 | +17% | **+2.7** |
| bbb-clip-03 | 1.4MB / **95.9** | **1.3MB** / 94.8 | +9% | **+1.0** |
| bbb-clip-04 | 2.1MB / **96.5** | **2.1MB** / 95.4 | +5% | **+1.1** |
| bbb-clip-05 | 2.4MB / **98.6** | **2.2MB** / 97.5 | +7% | **+1.1** |
| bbb-clip-06 | 2.3MB / **96.2** | **1.4MB** / 94.6 | +60% | **+1.5** |
| bbb-clip-07 | **2.3MB** / **96.8** | 2.6MB / 90.5 | **-13%** | **+6.2** |
| bbb-clip-08 | 7.1MB / **98.7** | **6.4MB** / 98.4 | +12% | **+0.3** |
| bbb-clip-09 | 1.8MB / **96.7** | **1.7MB** / 95.7 | +4% | **+1.0** |
| bbb-clip-10 | **3.6MB** / **100.0** | 4.3MB / 100.0 | **-17%** | 0.0 |
| big-buck-bunny | **2.9MB** / **94.4** | 3.1MB / 91.9 | **-6%** | **+2.5** |
| black-and-white | **11.4MB** / **99.9** | 12.1MB / 99.9 | **-5%** | 0.0 |
| candle-flame | 271KB / **97.5** | **219KB** / 96.7 | +24% | **+0.8** |
| city-night | **3.9MB** / **98.0** | 4.1MB / 97.2 | **-5%** | **+0.8** |
| color-wheel | 4.3MB / **98.5** | **4.2MB** / 98.0 | +3% | **+0.5** |
| fast-action | 3.6MB / **99.8** | **3.2MB** / 96.4 | +11% | **+3.5** |
| jellyfish | 2.9MB / **98.1** | 2.9MB / 97.3 | 0% | **+0.9** |
| pixel-art | **322KB** / 98.9 | 361KB / 98.9 | **-11%** | 0.0 |
| screen-recording | 747KB / **98.5** | **719KB** / 98.2 | +4% | **+0.2** |
| screencast | **27KB** / **97.7** | 50KB / 97.5 | **-47%** | **+0.2** |
| shapes | **386KB** / **97.2** | 398KB / 94.0 | **-3%** | **+3.2** |
| sintel | 1.6MB / **99.3** | **1.4MB** / 97.3 | +14% | **+1.9** |
| skin-tones | 223KB / **97.2** | **180KB** / 97.1 | +24% | **+0.1** |
| talking-head | 2.0MB / **97.9** | **1.2MB** / 95.0 | +65% | **+2.8** |
| two-frame | **317B** / **98.7** | 334B / 98.7 | **-5%** | 0.0 |

---

## 360p

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | 3.3MB / **94.3** | **2.5MB** / 91.8 | +30% | **+2.5** |
| bbb-clip-02 | 2.6MB / **95.1** | **2.0MB** / 91.6 | +29% | **+3.5** |
| bbb-clip-03 | 1007KB / **94.7** | **848KB** / 93.0 | +19% | **+1.7** |
| bbb-clip-04 | 1.4MB / **95.8** | **1.2MB** / 94.0 | +19% | **+1.8** |
| bbb-clip-05 | 1.6MB / **97.9** | **1.4MB** / 96.1 | +14% | **+1.9** |
| bbb-clip-06 | 1.4MB / **95.1** | **882KB** / 93.2 | +58% | **+1.9** |
| bbb-clip-07 | 1.7MB / **97.3** | 1.6MB / 88.4 | +10% | **+8.9** |
| bbb-clip-08 | 4.2MB / **98.3** | **3.7MB** / 97.1 | +13% | **+1.3** |
| bbb-clip-09 | 1.1MB / **96.5** | **1.0MB** / 94.8 | +10% | **+1.7** |
| bbb-clip-10 | **2.2MB** / **99.9** | 2.7MB / 99.9 | **-18%** | 0.0 |
| big-buck-bunny | 2.3MB / **93.7** | **1.7MB** / 89.5 | +35% | **+4.2** |
| black-and-white | **6.7MB** / **99.9** | 6.9MB / 99.8 | **-4%** | **+0.1** |
| candle-flame | 169KB / **97.1** | **153KB** / 96.2 | +11% | **+0.8** |
| city-night | 2.3MB / **95.8** | 2.3MB / 94.6 | +1% | **+1.2** |
| color-wheel | 2.7MB / **98.7** | 2.7MB / 97.2 | +3% | **+1.4** |
| fast-action | 2.1MB / **99.6** | **1.9MB** / 93.2 | +14% | **+6.3** |
| jellyfish | 1.8MB / **97.5** | **1.7MB** / 95.5 | +5% | **+1.9** |
| pixel-art | 324KB / **99.8** | **323KB** / 99.6 | 0% | **+0.1** |
| screen-recording | 503KB / **99.9** | **478KB** / 99.3 | +5% | **+0.6** |
| screencast | **28KB** / **94.1** | 44KB / 93.4 | **-36%** | **+0.6** |
| shapes | **272KB** / **96.7** | 313KB / 94.2 | **-13%** | **+2.5** |
| sintel | 1.0MB / **99.4** | **950KB** / 97.2 | +8% | **+2.2** |
| skin-tones | 172KB / **97.0** | **161KB** / 96.9 | +7% | **+0.1** |
| talking-head | 1.2MB / **96.6** | **755KB** / 93.5 | +61% | **+3.1** |
| two-frame | **244B** / **98.7** | 334B / 98.7 | **-25%** | 0.0 |

---

## 240p (shared palette for ≥2× downscale)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **1.0MB** / **88.9** | 1.1MB / 87.2 | **-10%** | **+1.7** |
| bbb-clip-02 | 1.1MB / **92.5** | **920KB** / 87.8 | +27% | **+4.7** |
| bbb-clip-03 | 456KB / **90.2** | **446KB** / 89.5 | +2% | **+0.7** |
| bbb-clip-04 | **613KB** / **93.2** | 627KB / 91.4 | **-2%** | **+1.7** |
| bbb-clip-05 | **701KB** / **95.1** | 753KB / 93.1 | **-7%** | **+2.0** |
| bbb-clip-06 | 514KB / **93.2** | **449KB** / 90.7 | +14% | **+2.5** |
| bbb-clip-07 | **789KB** / **95.6** | 828KB / 85.7 | **-5%** | **+9.9** |
| bbb-clip-08 | 2.0MB / **97.0** | **1.9MB** / 93.3 | +9% | **+3.6** |
| bbb-clip-09 | **460KB** / **92.8** | 519KB / 92.0 | **-12%** | **+0.7** |
| bbb-clip-10 | **983KB** / 95.5 | 1.3MB / **95.9** | **-26%** | -0.4 |
| big-buck-bunny | 833KB / **89.1** | **786KB** / 84.7 | +6% | **+4.4** |
| black-and-white | **2.9MB** / **98.1** | 3.0MB / 92.5 | **-4%** | **+5.6** |
| candle-flame | **66KB** / 95.5 | 100KB / **95.6** | **-34%** | -0.2 |
| city-night | 1.1MB / **91.7** | **1007KB** / 89.2 | +12% | **+2.5** |
| color-wheel | **1.3MB** / **96.8** | 1.3MB / 94.9 | **-1%** | **+1.9** |
| fast-action | 1.0MB / **96.9** | **930KB** / 86.8 | +12% | **+10.1** |
| jellyfish | 940KB / **94.8** | **897KB** / 91.7 | +5% | **+3.0** |
| pixel-art | 195KB / **100.0** | **181KB** / 100.0 | +7% | 0.0 |
| screen-recording | **214KB** / 97.4 | 262KB / **97.5** | **-18%** | -0.1 |
| screencast | **9KB** / **90.9** | 42KB / 89.4 | **-78%** | **+1.5** |
| shapes | 382KB / **95.3** | **197KB** / 91.6 | +94% | **+3.7** |
| sintel | 514KB / **99.8** | **513KB** / 96.9 | 0% | **+2.9** |
| skin-tones | **71KB** / 95.9 | 107KB / **96.1** | **-34%** | -0.2 |
| talking-head | 578KB / **94.6** | **395KB** / 90.8 | +46% | **+3.8** |
| two-frame | **189B** / **98.7** | 334B / 98.7 | **-43%** | 0.0 |

---

## 160p (shared palette, 3× downscale)

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **472KB** / **84.4** | 482KB / 81.9 | **-2%** | **+2.5** |
| bbb-clip-02 | 514KB / **90.0** | **408KB** / 83.8 | +26% | **+6.3** |
| bbb-clip-03 | **237KB** / **87.0** | 252KB / 85.6 | **-6%** | **+1.5** |
| bbb-clip-04 | 351KB / **90.0** | **326KB** / 87.7 | +8% | **+2.4** |
| bbb-clip-05 | **396KB** / **91.9** | 402KB / 89.1 | **-1%** | **+2.8** |
| bbb-clip-06 | 259KB / **89.2** | **240KB** / 87.0 | +8% | **+2.3** |
| bbb-clip-07 | **417KB** / **93.0** | 427KB / 81.4 | **-2%** | **+11.6** |
| bbb-clip-08 | 1.0MB / **94.8** | **974KB** / 87.3 | +7% | **+7.5** |
| bbb-clip-09 | **261KB** / **89.4** | 273KB / 88.7 | **-5%** | **+0.7** |
| bbb-clip-10 | **470KB** / **88.2** | 646KB / 86.2 | **-27%** | **+2.0** |
| big-buck-bunny | 397KB / **85.5** | **333KB** / 79.5 | +19% | **+6.0** |
| black-and-white | **1.3MB** / **92.5** | 1.3MB / 83.7 | **-2%** | **+8.9** |
| candle-flame | **37KB** / 94.0 | 72KB / **94.8** | **-49%** | -0.8 |
| city-night | 510KB / **87.6** | **437KB** / 83.9 | +17% | **+3.7** |
| color-wheel | **634KB** / **94.4** | 971KB / 92.1 | **-35%** | **+2.3** |
| fast-action | 509KB / **93.4** | **448KB** / 80.3 | +13% | **+13.1** |
| jellyfish | 487KB / **91.3** | **449KB** / 85.9 | +9% | **+5.4** |
| pixel-art | 115KB / **100.0** | **112KB** / 100.0 | +2% | 0.0 |
| screen-recording | **115KB** / **94.8** | 151KB / 93.3 | **-24%** | **+1.5** |
| screencast | **6KB** / **88.4** | 25KB / 87.9 | **-74%** | **+0.5** |
| shapes | 185KB / **93.7** | **128KB** / 90.7 | +44% | **+3.0** |
| sintel | **263KB** / **100.0** | 275KB / 98.5 | **-4%** | **+1.5** |
| skin-tones | **41KB** / 95.4 | 77KB / **97.0** | **-47%** | -1.6 |
| talking-head | 290KB / **93.0** | **208KB** / 87.9 | +39% | **+5.0** |
| two-frame | **146B** / **98.7** | 334B / 98.7 | **-55%** | 0.0 |

---

## Key Findings

### 1. VMAF advantage grows with downscaling

The background-aware quantizer's precision matters more at lower resolutions where every pixel counts. At 160p, gifhero averages +3.5 VMAF over gifski — nearly 3× the 480p advantage.

### 2. File size trade-off is content-dependent

gifhero wins on size for static/simple content (screencast, pixel-art, bbb-clip-10) but is larger on photographic content with complex motion (talking-head, bbb-clip-06). This is because gifhero's quality preset prioritizes visual quality over compression — gifski's default quality 90 is more aggressive.

### 3. Scene change handling dominates at all resolutions

bbb-clip-07 shows the largest VMAF gap at every resolution (+6.2 at 480p, +8.9 at 360p, +9.9 at 240p, +11.6 at 160p). Keyframe detection at motion-to-static transitions is a consistent differentiator.

### 4. Shared palette enables 240p/160p competitiveness

Without the shared palette (pre-fix), 240p averaged +1.9 VMAF. With it: +2.6. At 160p the improvement is even larger — the shared palette ensures clean transparency runs that LZW can compress efficiently.

### 5. Lanczos3 kernel fix was critical

A bug in the kernel scaling was causing excessive blur at high downscale ratios. After fixing, 160p went from losing 23/25 VMAF comparisons to winning 21/25.

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth set, correct kernel scaling)
  → Probe: static mask, motion × complexity, keyframes
  → staleThreshold: base(2/5/8) / sqrt(downscaleRatio)
  → Shared palette via Histogram (if downscaleRatio ≥ 2.0)
  → Frame 0 / keyframes: full-frame quantize, reset canvas
  → Frames 1+:
      Per-frame path: quantizeWithBackground(frame, canvas)
      Shared path: remapWithPalette(frame, sharedPalette, canvas)
  → tight crop → trim palette → lossy LZW → GIF89a
```
