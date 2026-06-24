# Temporal Denoising Strategy for gifhero

**Date:** 2026-06-24
**Status:** Proposed — not yet implemented or benchmarked.
**Context:** Investigation into reducing posterization on clips where gifhero loses VMAF to gifski, and improving compression efficiency through cleaner source data.

---

## Problem

gifhero produces more posterization (banding) than gifski on certain clips, particularly those with smooth gradients under slight motion (jellyfish, skin-tones, bbb-clip-05, candle-flame). Three mechanisms are responsible:

1. **Shared palette compromise** — when `colorComplexity >= 8000`, a single palette is built from ~10 sampled frames. Each frame's gradient detail must share the 256-color budget. gifski uses per-frame palettes.
2. **Adaptive maxColors cap** — quality preset caps at 224 for `colorComplexity >= 30000`. Fewer entries means fewer gradient steps.
3. **Binary importance map** — static pixels get importance=0, telling imagequant to completely ignore them during palette allocation. Static gradient pixels get no palette representation.

All three are driven by the probe's analysis of source data. Noisy source data inflates `colorComplexity` (sensor jitter creates spurious 6-bit-quantized colors) and causes pixels that should be static to fluctuate just above the motion threshold. This cascading effect triggers shared palettes, maxColors caps, and over-aggressive transparency on content that would be better served by per-frame palettes with full color budgets.

---

## How gifski Solves This

gifski's denoiser (`src/denoise.rs`, ~400 lines of Rust, zero external dependencies) is the key differentiator. It sits after downscaling and before quantization in the pipeline:

```
resize (Lanczos3) → spatial blur (3x3 median) → temporal denoise (5-frame) → quantize
```

### gifski's Algorithm

**Spatial component:** A 3x3 edge-preserving median filter. The median of all 9 pixels in the neighborhood is computed per channel. The result is only accepted if the color difference from the center pixel is below 1536 (weighted squared distance: `2*dR^2 + 3*dG^2 + dB^2`). Otherwise the original pixel is kept. This smooths flat regions but refuses to blur across edges.

**Temporal component:** Per-pixel state tracking with a 5-frame lookahead buffer. Each pixel has an accumulator (`Acc`) that stores:
- The last 5 frames' values (both original and blurred)
- The currently "on screen" background color (`bg_set`)
- How many frames the background has persisted (`stayed_for` / `can_stay_for`)

The threshold is quality-dependent: `(55 - quality/2)^2`. At quality=90 (gifhero's default), this gives threshold=100, roughly equivalent to a per-channel max diff of ~6.

**Decision logic per pixel:**
1. If current pixel is close to established background → output background, importance=0
2. If pixel is in a stable run → continue background, importance scales with duration
3. Otherwise → scan 4 frames ahead to see if the new color persists. Take the median of matching frames as the new background.

**Importance map output:** Graduated 0-205 values based on motion persistence:
- 0 frames persistence (transient/noise): importance 10-110
- 1 frame: 5-80
- 2 frames: 15-190
- 3+ frames (real motion): 50-205
- Unchanged/stable pixels: 0

This graduated map tells imagequant how to distribute palette entries — real motion gets the most, transient noise gets minimal, and truly static pixels get none.

**Cohort alternation:** Pixels are split into two arbitrary groups. Alternating frames apply different threshold sensitivity (1x vs 2x) to each cohort. This reduces unique colors per frame (helping quantization) with the other cohort catching up next frame — a form of temporal dithering at the denoiser level.

---

## Proposed Strategy for gifhero

### Phase 1: Temporal Median (3-Frame Window)

A minimal denoiser that captures the core benefit (temporal stabilization) at ~10% of gifski's complexity.

**Algorithm:**
```
For each pixel (x, y) in frame[t]:
  prev1 = denoisedFrame[t-1][x, y]
  prev2 = denoisedFrame[t-2][x, y]
  curr  = frame[t][x, y]

  For each channel c in {R, G, B}:
    maxDev = max(|curr[c] - prev1[c]|, |curr[c] - prev2[c]|, |prev1[c] - prev2[c]|)

  If maxDev <= threshold (5 per channel):
    output[c] = median(curr[c], prev1[c], prev2[c])   // for each channel
  Else:
    output = curr   // pass through unchanged
```

**Why temporal median:**
- Selects an actual observed value, never creates a new color. The quantizer sees fewer distinct colors, not interpolated ones that add to the palette burden.
- Robust to single-frame outliers (compression artifacts, sensor spikes). A single bright pixel in frame N is discarded if frames N-1 and N+1 agree.
- Median of 3 values costs 3 comparisons per channel — negligible.
- No accumulation/ghosting behavior (unlike IIR/recursive filters where errors persist).

**Why 3 frames, not 5:**
- 3 is the minimum useful window that catches the common noise pattern (random per-frame variation).
- gifski uses 5 because it does forward-scan persistence tracking — a much more complex algorithm. Without that, 5 frames adds latency and memory for marginal gain over 3.
- Memory cost: 2 previous denoised frames = `2 * width * height * 4` bytes. At 480x270: ~1 MB.

**Threshold of 5:**
- Matches the existing motion detection threshold in `probe.ts:98` (`if (d > 5) changed++`).
- gifski at quality=90 uses threshold=100 in weighted squared space, which is roughly per-channel 5-6 in max-channel-diff space. The values align.
- Conservative: only catches noise, not intentional gradual color changes.

**Where in the pipeline:**
```
Source frames
  → Lanczos3 downscale (if targetWidth set)
  → Temporal median denoise (proposed)      ← NEW
  → Probe: static mask, motion, complexity
  → Encode pipeline (unchanged)
```

After downscaling, before probe. This is gifski's ordering. Rationale:
- Downscaling already acts as a low-pass filter, reducing some noise.
- The denoiser operates at actual output resolution, so thresholds are resolution-appropriate.
- The probe sees denoised data, producing a tighter static mask, lower colorComplexity, and better downstream decisions.

**Implementation:** ~40 lines. No dependencies. Pure RGBA arithmetic, fits the codebase style.

```typescript
function denoiseFrames(
  frames: { data: Uint8ClampedArray; delay?: number }[],
  width: number,
  height: number,
  threshold: number = 5,
): void {
  // Mutates frames in place. Frame 0 and 1 pass through unchanged.
  const numPixels = width * height;
  // Keep references to previous denoised frames
  let prev2: Uint8ClampedArray | null = null;
  let prev1: Uint8ClampedArray | null = null;

  for (let f = 0; f < frames.length; f++) {
    if (f < 2) {
      prev2 = prev1;
      prev1 = frames[f].data;
      continue;
    }

    const curr = frames[f].data;
    const out = new Uint8ClampedArray(curr);

    for (let i = 0; i < numPixels; i++) {
      const si = i * 4;
      let maxDev = 0;
      for (let c = 0; c < 3; c++) {
        const a = curr[si + c], b = prev1![si + c], d = prev2![si + c];
        const dev = Math.max(Math.abs(a - b), Math.abs(a - d), Math.abs(b - d));
        if (dev > maxDev) maxDev = dev;
      }

      if (maxDev <= threshold) {
        for (let c = 0; c < 3; c++) {
          const a = curr[si + c], b = prev1![si + c], d = prev2![si + c];
          // Median of 3: sort and take middle
          out[si + c] = a > b
            ? (b > d ? b : (a > d ? d : a))
            : (a > d ? a : (b > d ? d : b));
        }
      }
      // Alpha passes through unchanged
    }

    frames[f] = { data: out, delay: frames[f].delay };
    prev2 = prev1;
    prev1 = out;
  }
}
```

### Phase 2: Graduated Importance Map

Change the binary importance map to give static pixels minimal (but nonzero) importance:

```typescript
// Current:
importanceMap[j] = probe.staticMask[j] ? 0 : 255;

// Proposed:
importanceMap[j] = probe.staticMask[j] ? 48 : 255;
```

Importance 48 (~19%) tells imagequant "these pixels matter less, but allocate a few palette entries for them." This ensures static gradient regions have color representation when the occasional near-static pixel needs quantization.

This is a one-line change that directly addresses banding in static gradients. It is independent of the temporal denoiser and can be tested separately.

**Note:** The importance map is only used on the per-frame quantization path (`gifQuantBg`), not the shared palette path (`gifRemapPalette`). For shared palette frames, the denoiser is the mitigation — cleaner data means the histogram allocates palette entries to real gradient steps instead of noise.

---

## What This Does NOT Include

### Spatial blur (3x3 median/mean)
gifski applies a 3x3 edge-preserving median before temporal denoising. This smooths within-frame noise (sensor grain, rendering dither). Skipped for now because:
- The temporal component is more impactful for GIF compression (inter-frame consistency drives transparency and LZW).
- Previous strategy tests showed that chaining multiple optimizations often produces diminishing returns or unexpected regressions.
- Can be added later if the temporal-only results are promising.

### Forward-scan persistence tracking
gifski scans 4 frames ahead to determine how long a color persists. This enables better importance calibration (transient = low importance, persistent = high). Skipped because:
- Requires 5-frame buffering and per-pixel state structs — significant complexity.
- The 3-frame median captures the core stabilization benefit without the machinery.

### Cohort alternation
gifski's trick of applying different thresholds to two pixel groups on alternating frames, reducing unique colors per frame. This is a clever optimization but tightly coupled to gifski's importance map generation. Not applicable without the full denoiser.

### Quality-adaptive threshold
gifski scales the threshold quadratically with quality: `(55 - quality/2)^2`. At q90: threshold=100; at q80: threshold=225. For gifhero's initial implementation, a fixed threshold of 5 (matching the existing motion detection threshold) is simpler and sufficient. If the denoiser proves effective, a quality-scaled threshold can be added.

---

## Expected Impact

### Calibrated against test results

The compression strategy tests showed that theoretical estimates were consistently 5-20x too optimistic. Calibrating accordingly:

| Metric | Optimistic | Conservative (calibrated) |
|--------|-----------|--------------------------|
| Size reduction | 3-10% | **1-3%** |
| colorComplexity reduction | 10-30% on noisy content | **5-15%** |
| VMAF change | +0.5 | **+0.0 to +0.3** |
| Posterization improvement | Significant | **Measurable on affected clips** |

### Where gains are most likely
- **Camera-sourced fixtures** (skin-tones, talking-head, jellyfish, candle-flame): sensor noise is the primary source of false inter-frame differences. The denoiser directly addresses this.
- **Video-compressed sources** (bbb-clip-*): compression artifacts create block-level noise that varies per frame. The temporal median smooths this.
- **Low-resolution encodes** (160p, 240p): at lower resolutions, each pixel represents more source area. Noise that was sub-pixel at 480p becomes full-pixel at 160p, making the denoiser more impactful.

### Where gains are unlikely
- **Rendered/synthetic content** (shapes, pixel-art, screencast): no source noise. The denoiser will find all pixels either perfectly static (caught by the existing static mask) or intentionally changed. Near-zero impact.
- **High-motion content** (fast-action): most pixels exceed the threshold on every frame. The denoiser passes them through unchanged.

---

## Measurement Plan

1. **Implement Phase 1** (temporal median) and **Phase 2** (graduated importance map) independently.
2. **Benchmark each separately** against the current baseline on all 200 encodes (25 fixtures x 4 resolutions).
3. **Key metrics to watch:**
   - Total file size vs baseline and vs gifski
   - VMAF delta (must remain >= -2.0 on every encode)
   - CAMBI banding score (should improve on affected clips)
   - `colorComplexity` values from the probe (direct measure of denoiser effectiveness)
   - Encoding time overhead (must stay < 15ms total for 60 frames at 480x270)
4. **If both help independently**, test them combined.
5. **Clips to watch closely:** skin-tones (worst VMAF delta), jellyfish (gradient-heavy), candle-flame (subtle motion), bbb-clip-05 (animated gradients).

---

## References

- gifski denoiser source: https://github.com/ImageOptim/gifski/blob/main/src/denoise.rs
- gifski pipeline: https://github.com/ImageOptim/gifski/blob/main/src/lib.rs
- FFmpeg hqdn3d: https://ffmpeg.org/doxygen/0.7/vf__hqdn3d_8c-source.html
- Netflix AV1 film grain synthesis: https://netflixtechblog.com/av1-scale-film-grain-synthesis-the-awakening-ee09cfdff40b
- Video denoising compression impact: https://mattgadient.com/in-depth-look-at-de-noising-in-handbrake-with-imagevideo-examples/
- Content-adaptive denoising for video coding: US Patent 11197008
- libimagequant importance map: https://docs.rs/imagequant/latest/imagequant/struct.Image.html
- Bilateral filtering for posterization: https://arxiv.org/pdf/1802.01009
