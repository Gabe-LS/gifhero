# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-23  
**Commit:** 8e48165  
**gifhero:** quality preset (imagequant q90 speed 1, lossyLzw 4, linear staleThreshold, keyframes, Lanczos3, shared palette ≥2×)  
**gifski:** default settings (quality 90)  
**Fixtures:** 25 × 4 resolutions = 200 encodes per encoder

---

## Summary

| Resolution | VMAF wins | Size wins | Avg VMAF Δ |
|-----------|-----------|-----------|------------|
| **480p** | **19/25** | **17/25** | **+1.0** |
| **360p** | **21/25** | **16/25** | **+1.4** |
| **240p** | **20/25** | **18/25** | **+2.4** |
| **160p** | **21/25** | **17/25** | **+3.4** |

gifhero wins VMAF at every resolution. Size wins ≥ 16/25 at all resolutions. Only 9 out of 200 encodes are >10% larger than gifski — all have positive VMAF delta (quality-for-size tradeoff).

---

## Optimization Journey

Started with **32 cases >10% larger** than gifski. Systematically reduced to **9** through:

| Fix | Cases removed | Key change |
|-----|--------------|------------|
| staleThreshold override bug | 0 | Fixed ignored user override |
| Motion floor (>5% → threshold ≥5) | 6 | talking-head +65% → +11% |
| Motion floor lowered (>1%) | 6 | bbb-clip-06 +60% → -2% |
| Minimum floor raised to 3 | 2 | skin-tones +24% → +6% |
| Linear threshold scale | 8 | bbb-clip-02 +17% → +5% |
| No scaling for <2× downscale | 5 | 360p cluster fixed |
| **Total** | **23 cases fixed** | **32 → 9 remaining** |

---

## Remaining 9 Cases >10% Larger

All have positive VMAF delta — quality-for-size tradeoffs at the structural limit.

| Fixture | Res | gifhero | gifski | Δ Size | Δ VMAF |
|---------|-----|---------|--------|--------|--------|
| bbb-clip-08 | 480p | 7.1MB / 98.7 | 6.4MB / 98.4 | +12% | +0.3 |
| talking-head | 480p | 1.3MB / 96.3 | 1.2MB / 95.0 | +11% | +1.3 |
| bbb-clip-02 | 360p | 2.3MB / 94.5 | 2.0MB / 91.6 | +15% | +2.9 |
| bbb-clip-08 | 360p | 4.2MB / 98.2 | 3.7MB / 97.1 | +12% | +1.2 |
| fast-action | 240p | 1.0MB / 96.9 | 930KB / 86.8 | +12% | +10.1 |
| big-buck-bunny | 160p | 380KB / 85.5 | 333KB / 79.5 | +14% | +6.1 |
| city-night | 160p | 510KB / 87.6 | 437KB / 83.9 | +17% | +3.7 |
| fast-action | 160p | 509KB / 93.4 | 448KB / 80.3 | +13% | +13.1 |
| talking-head | 160p | 243KB / 92.3 | 208KB / 87.9 | +17% | +4.4 |

**Root cause**: per-frame imagequant palettes produce finer dithering than gifski's default q90, which compresses into more LZW data. The threshold is already at maximum (8) for high-complexity content. Further increases degrade VMAF below gifski's level.

---

## Architecture

```
Source frames
  → Lanczos3 downscale (if targetWidth < source width)
  → Probe: static mask, motion × complexity, keyframes
  → staleThreshold: linear(3-8) from complexity/4000, floor 3 or 5
      No scaling for ratio < 2; / sqrt(ratio) for ≥ 2
  → Shared palette via Histogram (if ratio ≥ 2.0)
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
autoThreshold = clamp(3, 8, round(3 + 5 × min(1, complexity / 4000)))
threshold = max(motionFloor, autoThreshold)
if downscaleRatio ≥ 2: threshold = round(threshold / sqrt(ratio))
```
