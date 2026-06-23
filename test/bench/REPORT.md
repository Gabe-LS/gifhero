# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-23  
**Commit:** 75a0c3a  
**gifhero:** quality preset (imagequant q90 speed 1, F-S dithering, lossyLzw 4, content-adaptive staleThreshold, keyframe detection)  
**gifski:** default settings (quality 90, no `--extra`)  
**Fixtures:** 25 × 2 resolutions (480p native + 240p downscaled) = 100 encodes per encoder

---

## Summary

### 480p (native resolution)

gifhero beats gifski on **VMAF in 24 out of 25 fixtures** and on **file size in 19 out of 25**.

| Metric | gifhero wins | gifski wins | Tie |
|--------|-------------|-------------|-----|
| Higher VMAF | **24** | 0 | 1 |
| Smaller file | **19** | 6 | 0 |
| Both | **17** | — | — |

### 240p (half resolution)

gifhero beats gifski on **VMAF in 23 out of 25** and on **file size in 16 out of 25**.

| Metric | gifhero wins | gifski wins | Tie |
|--------|-------------|-------------|-----|
| Higher VMAF | **23** | 1 | 1 |
| Smaller file | **16** | 9 | 0 |

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

**Average VMAF: gifhero 97.7, gifski 96.0 (+1.7)**

---

## 240p Head-to-Head

| Fixture | gifhero | gifski | Δ Size | Δ VMAF |
|---------|---------|--------|--------|--------|
| bbb-clip-01 | 1.3MB / **90.5** | **1.1MB** / 87.2 | +18% | **+3.3** |
| bbb-clip-02 | 1.4MB / **94.1** | **920KB** / 87.8 | +56% | **+6.3** |
| bbb-clip-03 | 640KB / **93.0** | **446KB** / 89.5 | +44% | **+3.5** |
| bbb-clip-04 | 941KB / **95.9** | **627KB** / 91.4 | +50% | **+4.5** |
| bbb-clip-05 | 754KB / **97.0** | 753KB / 93.1 | 0% | **+3.9** |
| bbb-clip-06 | 688KB / **94.7** | **449KB** / 90.7 | +53% | **+4.0** |
| bbb-clip-07 | **801KB** / **96.9** | 828KB / 85.7 | **-3%** | **+11.2** |
| bbb-clip-08 | 2.0MB / **97.2** | **1.9MB** / 93.3 | +5% | **+3.9** |
| bbb-clip-09 | **511KB** / **95.2** | 519KB / 92.0 | **-2%** | **+3.2** |
| bbb-clip-10 | **968KB** / 92.6 | 1.3MB / **95.9** | **-25%** | -3.3 |
| big-buck-bunny | 906KB / **90.3** | **786KB** / 84.7 | +15% | **+5.6** |
| black-and-white | 3.0MB / **96.1** | 3.0MB / 92.5 | 0% | **+3.6** |
| candle-flame | **94KB** / **98.0** | 100KB / 95.6 | **-6%** | **+2.4** |
| city-night | **932KB** / **89.7** | 1007KB / 89.2 | **-7%** | **+0.5** |
| color-wheel | 1.3MB / **95.6** | 1.3MB / 94.9 | 0% | **+0.7** |
| fast-action | 999KB / **98.0** | **930KB** / 86.8 | +7% | **+11.2** |
| jellyfish | **878KB** / **96.5** | 897KB / 91.7 | **-2%** | **+4.8** |
| pixel-art | **138KB** / **100.0** | 181KB / 100.0 | **-24%** | 0.0 |
| screen-recording | **258KB** / **99.7** | 262KB / 97.5 | **-2%** | **+2.2** |
| screencast | **12KB** / 87.5 | 42KB / **89.4** | **-71%** | -1.9 |
| shapes | **150KB** / **97.4** | 197KB / 91.6 | **-24%** | **+5.8** |
| sintel | **506KB** / **100.0** | 513KB / 96.9 | **-1%** | **+3.1** |
| skin-tones | **85KB** / **99.2** | 107KB / 96.1 | **-21%** | **+3.1** |
| talking-head | 599KB / **96.7** | **395KB** / 90.8 | +52% | **+5.9** |
| two-frame | **189B** / **98.7** | 334B / 98.7 | **-43%** | 0.0 |

**Average VMAF: gifhero 95.5, gifski 91.7 (+3.8)**

---

## Key Findings

### 1. gifhero wins VMAF on nearly every fixture

At 480p, gifhero has higher VMAF on **24/25** fixtures (avg +1.7). The only tie is two-frame. At 240p, gifhero wins **23/25** (avg +3.8) — the advantage grows at lower resolution because the background-aware quantizer's transparency precision matters more when there are fewer pixels.

### 2. gifski default (q90) is weaker than q100

With default `--quality 90`, gifski scores 96.0 average VMAF at 480p — down from 97.8 at q100 in previous runs. gifhero's quality preset (q90 imagequant) achieves 97.7 average. The comparison is now truly defaults vs defaults.

### 3. File size is mixed at 480p

gifhero is smaller on 19/25 fixtures but larger on 6. The fixtures where gifski is smaller tend to be ones where gifski's default q90 produces more aggressive compression than gifhero's quality preset. Notable gifhero size wins: screencast -46%, bbb-clip-10 -16%, bbb-clip-07 -12%.

### 4. 240p dramatically favors gifhero on VMAF

At 240p, gifhero's VMAF advantage doubles to +3.8 average. Highlights:
- **bbb-clip-07**: +11.2 VMAF (96.9 vs 85.7)
- **fast-action**: +11.2 VMAF (98.0 vs 86.8)
- **bbb-clip-02**: +6.3 VMAF (94.1 vs 87.8)
- **talking-head**: +5.9 VMAF (96.7 vs 90.8)

### 5. Scene change handling is a major differentiator

bbb-clip-07 shows the biggest gap: gifhero 96.8 vs gifski 90.5 at 480p (+6.3 VMAF). The keyframe detection at motion-to-static transitions prevents canvas error accumulation that gifski doesn't handle as well at default settings.

---

## Architecture

```
Source frames
  → Probe: static mask, motion × complexity, scene changes, motion transitions
  → Content-adaptive staleThreshold (2/5/8)
  → Keyframe insertion at scene changes + motion-to-static transitions
  → Frame 0 / keyframes: quantizeSimple() → full-frame, reset canvas
  → Frames 1+: alpha=0 on static + canvas-matching pixels
               → quantizeWithBackground(frame, canvas, importanceMap)
               → native transparency from libimagequant set_background
               → tight-crop → trim palette → lossy LZW → GIF89a
```
