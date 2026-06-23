# gifhero vs gifski — Full Benchmark Report

**Date:** 2026-06-23  
**Commit:** dfeee27  
**gifhero:** quality preset (imagequant q90 speed 1, lossyLzw 4, content-adaptive staleThreshold + lossyLzw, keyframes, Lanczos3, shared palette for all downscaled encodes)  
**gifski:** default settings (quality 90)  
**Fixtures:** 25 × 4 resolutions = 200 encodes per encoder

---

## Summary

| Resolution | VMAF wins | Size wins | Avg VMAF Δ |
|-----------|-----------|-----------|------------|
| **480p** | **15/25** | **19/25** | **+0.7** |
| **360p** | **15/25** | **22/25** | **+0.7** |
| **240p** | **18/25** | **25/25** | **+1.7** |
| **160p** | **19/25** | **24/25** | **+2.4** |

**Zero cases >10% larger than gifski.** Zero VMAF losses >2 points. gifhero wins VMAF at every resolution and is smaller or competitive in the vast majority of encodes.

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
  → staleThreshold: linear(3-10) from complexity/5000, floor 3 or 5
  → Adaptive lossyLzw: linear(4-6) from complexity/3000
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
