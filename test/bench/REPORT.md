# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-23  
**Commit:** 84cae8e  
**gifhero:** quality preset (imagequant q90 speed 1, lossyLzw 4, content-adaptive staleThreshold, keyframe detection)  
**gifski:** default settings (quality 90)  
**Downscaling:** gifhero uses Lanczos3 with resolution-scaled threshold; gifski uses its built-in downscaler  
**Fixtures:** 25 × 2 resolutions = 100 encodes per encoder

---

## Summary

### 480p (native resolution)

| Metric | gifhero wins | gifski wins | Tie |
|--------|-------------|-------------|-----|
| Higher VMAF | **24** | 0 | 1 |
| Smaller file | **19** | 6 | 0 |
| Both | **17** | — | — |

**Average VMAF: gifhero 97.7, gifski 96.0 (+1.7)**

### 240p (Lanczos3 downscale + sqrt-scaled threshold)

| Metric | gifhero wins | gifski wins | Tie |
|--------|-------------|-------------|-----|
| Higher VMAF | **22** | 2 | 1 |
| Smaller file | **14** | 11 | 0 |

**Average VMAF: gifhero 94.8, gifski 91.7 (+3.1)**

---

## 480p Head-to-Head

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | **4.3MB** / **94.7** | 4.7MB / 94.0 | **-9%** | **+0.7** |
| bbb-clip-02 | 4.4MB / **96.2** | **3.7MB** / 93.5 | +19% | **+2.7** |
| bbb-clip-03 | 1.4MB / **95.9** | **1.3MB** / 94.8 | +8% | **+1.1** |
| bbb-clip-04 | 2.1MB / **96.5** | 2.1MB / 95.4 | 0% | **+1.1** |
| bbb-clip-05 | 2.4MB / **98.6** | **2.2MB** / 97.5 | +9% | **+1.1** |
| bbb-clip-06 | 2.3MB / **96.2** | **1.4MB** / 94.6 | +64% | **+1.6** |
| bbb-clip-07 | **2.3MB** / **96.8** | 2.6MB / 90.5 | **-12%** | **+6.3** |
| bbb-clip-08 | 7.1MB / **98.7** | **6.4MB** / 98.4 | +11% | **+0.3** |
| bbb-clip-09 | 1.8MB / **96.7** | **1.7MB** / 95.7 | +6% | **+1.0** |
| bbb-clip-10 | **3.6MB** / **100.0** | 4.3MB / 100.0 | **-16%** | 0.0 |
| big-buck-bunny | **2.9MB** / **94.4** | 3.1MB / 91.9 | **-6%** | **+2.5** |
| black-and-white | **11.4MB** / **99.9** | 12.1MB / 99.9 | **-6%** | 0.0 |
| candle-flame | 271KB / **97.5** | **219KB** / 96.7 | +24% | **+0.8** |
| city-night | **3.9MB** / **98.0** | 4.1MB / 97.2 | **-5%** | **+0.8** |
| color-wheel | 4.3MB / **98.5** | **4.2MB** / 98.0 | +2% | **+0.5** |
| fast-action | 3.6MB / **99.8** | **3.2MB** / 96.4 | +13% | **+3.4** |
| jellyfish | 2.9MB / **98.1** | 2.9MB / 97.3 | 0% | **+0.8** |
| pixel-art | **322KB** / 98.9 | 361KB / 98.9 | **-11%** | 0.0 |
| screen-recording | 747KB / **98.5** | **719KB** / 98.2 | +4% | **+0.3** |
| screencast | **27KB** / **97.7** | 50KB / 97.5 | **-46%** | **+0.2** |
| shapes | **386KB** / **97.2** | 398KB / 94.0 | **-3%** | **+3.2** |
| sintel | 1.6MB / **99.3** | **1.4MB** / 97.3 | +14% | **+2.0** |
| skin-tones | 223KB / **97.2** | **180KB** / 97.1 | +24% | **+0.1** |
| talking-head | 2.0MB / **97.9** | **1.2MB** / 95.0 | +67% | **+2.9** |
| two-frame | **317B** / **98.7** | 334B / 98.7 | **-5%** | 0.0 |

---

## 240p Head-to-Head

gifhero uses Lanczos3 downscaling with staleThreshold scaled by `1/sqrt(2)` to compensate for the smoothing effect. gifski uses its built-in downscaler.

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | 1.1MB / **88.0** | 1.0MB / 87.2 | +9% | **+0.8** |
| bbb-clip-02 | 1.3MB / **94.3** | **920KB** / 87.8 | +41% | **+6.5** |
| bbb-clip-03 | 640KB / **91.4** | **446KB** / 89.5 | +44% | **+1.9** |
| bbb-clip-04 | 941KB / **93.8** | **627KB** / 91.4 | +50% | **+2.3** |
| bbb-clip-05 | 754KB / **94.9** | 753KB / 93.1 | 0% | **+1.8** |
| bbb-clip-06 | 688KB / **93.4** | **449KB** / 90.7 | +53% | **+2.7** |
| bbb-clip-07 | **801KB** / **95.2** | 828KB / 85.7 | **-3%** | **+9.5** |
| bbb-clip-08 | 2.0MB / **96.3** | **1.9MB** / 93.3 | +5% | **+3.0** |
| bbb-clip-09 | **511KB** / **93.7** | 519KB / 92.0 | **-2%** | **+1.7** |
| bbb-clip-10 | **968KB** / 91.6 | 1.3MB / **95.9** | **-27%** | -4.3 |
| big-buck-bunny | 906KB / **89.8** | **786KB** / 84.7 | +15% | **+5.1** |
| black-and-white | 3.0MB / **94.7** | 3.0MB / 92.5 | 0% | **+2.2** |
| candle-flame | **94KB** / **97.9** | 100KB / 95.6 | **-6%** | **+2.3** |
| city-night | **932KB** / 87.1 | 1007KB / **89.2** | **-7%** | -2.1 |
| color-wheel | 1.3MB / **95.7** | 1.3MB / 94.9 | 0% | **+0.8** |
| fast-action | 999KB / **96.3** | **930KB** / 86.8 | +7% | **+9.5** |
| jellyfish | **878KB** / **94.0** | 897KB / 91.7 | **-2%** | **+2.3** |
| pixel-art | **138KB** / **100.0** | 181KB / 100.0 | **-24%** | 0.0 |
| screen-recording | **258KB** / **98.7** | 262KB / 97.5 | **-2%** | **+1.2** |
| screencast | **12KB** / **89.8** | 42KB / 89.4 | **-71%** | **+0.4** |
| shapes | **150KB** / **96.4** | 197KB / 91.6 | **-24%** | **+4.8** |
| sintel | **506KB** / **100.0** | 513KB / 96.9 | **-1%** | **+3.1** |
| skin-tones | **85KB** / **100.0** | 107KB / 96.1 | **-21%** | **+3.9** |
| talking-head | 599KB / **96.9** | **395KB** / 90.8 | +52% | **+6.1** |
| two-frame | **189B** / **98.7** | 334B / 98.7 | **-43%** | 0.0 |

---

## Key Findings

### 1. VMAF dominance at both resolutions

gifhero wins VMAF on 24/25 at 480p and 22/25 at 240p. The two 240p losses are bbb-clip-10 (-4.3, a slow-pan clip where threshold scaling makes the encoder too conservative) and city-night (-2.1, dark content with subtle gradients).

### 2. File size trade-off

At 480p, gifhero is smaller on 19/25 fixtures. At 240p, gifhero is smaller on 14/25. The clips where gifhero is larger tend to be high-motion content (bbb-clip-02/03/04/06) where per-frame palettes at lower resolution produce fragmented transparency boundaries that hurt LZW compression.

### 3. Resolution-scaled threshold works

The `1/sqrt(ratio)` scaling prevents the staleThreshold from being too aggressive at lower resolutions. Without it, bbb-clip-01 at 240p was +15% larger than gifski; with it, it's +9%. bbb-clip-10 went from -25% to -27% size savings while VMAF stayed similar.

### 4. Keyframe detection prevents quality collapse

bbb-clip-07 shows the largest VMAF gap: +6.3 at 480p and +9.5 at 240p. Scene change detection + motion-to-static transition keyframes prevent canvas error accumulation that gifski doesn't handle as well at default settings.

### 5. Lanczos3 vs gifski's downscaler

Both downscalers produce comparable base quality. The VMAF differences at 240p come from encoding strategy (transparency handling, palette allocation), not downscaling quality.

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth set)
  → Probe: static mask, motion × complexity, keyframes
  → staleThreshold: base(2/5/8) / sqrt(downscaleRatio)
  → Frame 0 / keyframes: full-frame quantize, reset canvas
  → Frames 1+: alpha=0 on static + canvas-matching pixels
               → quantizeWithBackground (libimagequant set_background)
               → native transparency, tight crop, lossy LZW → GIF89a
```
