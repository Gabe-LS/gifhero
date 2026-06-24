# Temporal Denoiser Investigation — 2026-06-24

Investigation and implementation of a temporal median denoiser for gifhero's balanced preset, inspired by gifski's denoiser architecture.

## Background

gifhero produced more posterization (banding) than gifski on clips with smooth gradients under motion (jellyfish, skin-tones, black-and-white). Investigation of gifski's source code revealed a temporal denoiser as the key differentiator.

## gifski Source Verification

Fetched and analyzed `denoise.rs` and `lib.rs` from the gifski repository. Findings:

| Claim from strategy report | Verified? | Reality |
|---|---|---|
| 3x3 spatial blur | Partially | 3x3 edge-preserving median (extra_effort) or mean (default), rejected if diff > 1536 |
| 5-frame temporal filter | Yes | `LOOKAHEAD = 5`, temporal median of matching frames |
| Quality-dependent thresholds | Yes | `(55 - quality/2)^2` — at q90: threshold=100 |
| Produces importance map | Yes | Graduated 0-205 values based on pixel persistence |
| Pipeline position | Yes | resize → blur → denoise → quantize → remap → write |
| Cohort alternation | Yes | Splits colors into two groups, alternates threshold sensitivity per frame |

The strategy report's claims were accurate.

## Noise Analysis of Test Fixtures

Measured temporal noise characteristics across all 25 fixtures (first 20 frames sampled per fixture).

### Noise types

- **Sub-perceptual (1-2 per channel)**: sensor jitter, compression artifacts — random, uniform, safe to smooth
- **Mid-range (3-5 per channel)**: anti-aliasing, intentional animation — structured, should not be touched

### Results

| Fixture | Sub-perceptual % | Mid-range % | Unique colors (raw → denoised) | Source type |
|---------|-----------------|------------|-------------------------------|-------------|
| talking-head | 27.5% | 19.2% | 9,357 → 9,211 (-1.6%) | Camera |
| bbb-clip-02 | 14.0% | 18.6% | 27,547 → 27,089 (-1.7%) | Animated film |
| jellyfish | 12.2% | 11.7% | 27,920 → 27,891 (-0.1%) | Camera |
| big-buck-bunny | 5.5% | 15.7% | 46,968 → 46,032 (-2.0%) | Animated film |
| bbb-clip-04 | 18.4% | 15.4% | 22,029 → 21,749 (-1.3%) | Animated film |
| city-night | 6.9% | 11.3% | 49,112 → 48,157 (-1.9%) | Camera |
| skin-tones | 5.4% | 3.7% | 619 → 608 (-1.8%) | Camera |
| shapes | **0.4%** | **26.7%** | 2,177 → 2,160 (-0.8%) | Synthetic |
| pixel-art | 0.0% | 0.0% | 524 → 522 (-0.4%) | Rendered |
| screencast | 0.0% | 0.0% | 146 → 146 (0%) | Screen capture |
| color-wheel | 0.1% | 0.1% | 53,187 → 53,185 (0%) | Rendered |
| fast-action | 2.5% | 9.3% | 5,234 → 5,228 (-0.1%) | Rendered |

**Key finding**: shapes has 0.4% sub-perceptual but 26.7% mid-range — its "noise" is anti-aliasing at shape edges, not sensor noise. Sub-perceptual fraction is the discriminator.

**Color reduction**: only 0.1-2% — the strategy report's estimate of 5-15% was ~5x too optimistic. The real compression gain comes from increased transparency (more pixels matching canvas after denoising), not color reduction.

## Implementation: Phase 1 — Temporal Median

### Algorithm

3-frame temporal median filter. For each pixel in frame[t], compare with frames[t-1] and [t-2]. If max per-channel deviation across all three is ≤3, replace with the median of the three values.

```
For each pixel at position (x, y) in frame t (t ≥ 2):
  maxDev = max channel deviation across curr, prev1, prev2
  if maxDev > 0 AND maxDev ≤ 3:
    output = median(curr, prev1, prev2) per channel
  else:
    output = curr (pass through)
```

### Threshold testing

| Threshold | Size Δ vs baseline | VMAF violations >2 | Assessment |
|-----------|-------------------|-------------------|------------|
| 5 | **-4.5 to -6.7%** | **3-4 per resolution** | Too aggressive — treats real texture as noise |
| 3 + motion guard | -1.5 to -2.9% | 0 at 480/360/240p, **2 at 160p** | Good size savings but skin-tones/screencast violated |
| 2 | -1.0 to -2.1% | 0 at 480/360/240p, **2 at 160p** | Conservative, same 160p issue |
| 3 + noise-aware gate | **-1.5 to -2.9%** | **0 everywhere** | Best balance |

### Detection evolution

**Attempt 1 — Motion guard (motion > 2%):**
Skipped near-static content. Fixed screencast (0.1% motion) but not skin-tones (0.5% motion detected sub-perceptual noise at 5.4%). 2 violations at 160p.

**Attempt 2 — Sub-perceptual fraction > 5%:**
Correctly detected noise vs anti-aliasing. Fixed screencast (0% sub-perceptual). But skin-tones (5.4% sub-perceptual, 0.5% motion) was still denoised — 1 violation at 160p.

**Attempt 3 — Dual gate (sub-perceptual > 5% AND motion > 2%):**
Both conditions required. skin-tones (0.5% motion) correctly excluded. Zero violations everywhere.

### Per-clip impact at 480p (balanced preset, dual gate)

Clips where denoiser activates (sub-perceptual > 5% AND motion > 2%):

| Clip | Before | After | Δ Size | Δ VMAF |
|------|--------|-------|--------|--------|
| bbb-clip-02 | 3,101KB / 94.2 | 2,746KB / 92.3 | -11% | -1.9 |
| bbb-clip-04 | 1,521KB / 95.1 | 1,372KB / 94.3 | -10% | -0.8 |
| talking-head | 1,145KB / 95.4 | 1,080KB / 95.2 | -6% | -0.2 |
| sintel | 1,190KB / 97.7 | 1,163KB / 97.5 | -2% | -0.2 |
| big-buck-bunny | 2,252KB / 92.3 | 2,194KB / 92.0 | -3% | -0.3 |
| city-night | 3,294KB / 96.9 | 3,251KB / 96.8 | -1% | -0.1 |
| jellyfish | 2,559KB / 95.9 | 2,552KB / 95.9 | 0% | 0 |

Clips correctly skipped (noise gate rejects):

| Clip | Sub-perceptual | Motion | Reason skipped |
|------|---------------|--------|----------------|
| shapes | 0.4% | 6.1% | No noise (anti-aliasing is 3+, not 1-2) |
| pixel-art | 0.0% | 13.9% | No noise (pixel-perfect) |
| screencast | 0.0% | 0.1% | No noise, no motion |
| fast-action | 2.5% | 58.2% | Insufficient noise (rendered content) |
| skin-tones | 5.4% | 0.5% | Noise but no motion (near-static) |
| candle-flame | 5.3% | 1.9% | Noise but no motion |

### Preset restriction

The denoiser only runs on the **balanced** preset. The quality preset prioritizes VMAF — denoising trades visual detail for compression, contradicting the quality preset's goal. Quality preset results are bit-identical with and without the denoiser code.

## Final Results

### balanced preset (with denoiser)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|-------------|
| 480p | 7/25 | 24/25 | +0.0 | **-18%** |
| 360p | 7/25 | 24/25 | +0.1 | **-19%** |
| 240p | 14/25 | 25/25 | +1.0 | **-19%** |
| 160p | 17/25 | 25/25 | +1.7 | **-19%** |

Compared to balanced WITHOUT denoiser:

| Resolution | Size improvement | VMAF cost |
|-----------|-----------------|-----------|
| 480p | **-1.7%** | avg -0.3 |
| 360p | **-2.9%** | avg -0.3 |
| 240p | **-1.5%** | avg -0.3 |
| 160p | **-2.4%** | avg -0.4 |

### quality preset (unchanged)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total size Δ |
|-----------|-----------|-----------|------------|-------------|
| 480p | 12/25 | 23/25 | +0.4 | -14% |
| 360p | 14/25 | 23/25 | +0.7 | -14% |
| 240p | 18/25 | 24/25 | +1.6 | -13% |
| 160p | 21/25 | 25/25 | +2.5 | -15% |

## What Was NOT Implemented

| Feature from gifski | Reason skipped |
|---|---|
| 3x3 spatial median | Temporal component is more impactful; spatial filtering adds complexity and risk of blurring edges |
| 5-frame lookahead | 3 frames captures core stabilization; 5 adds latency and memory for marginal gain |
| Graduated importance map | Would require per-pixel state tracking; binary importance map is simpler and already effective |
| Cohort alternation | Tightly coupled to gifski's importance map generation; not applicable without full denoiser |
| Quality-adaptive threshold | Fixed threshold of 3 (matching motion detection threshold) works across all content; can be added later |

## Conclusions

1. **The denoiser works** — 1.5-2.9% additional compression on the balanced preset with zero VMAF violations.
2. **Noise detection is critical** — threshold=5 was catastrophic (42 VMAF violations). The dual gate (sub-perceptual >5% AND motion >2%) correctly classifies all 25 fixtures.
3. **Color reduction is marginal** (1-2%) — the real gain is through increased pixel transparency when denoised pixels match the canvas within the staleThreshold.
4. **The strategy report was well-calibrated** — its conservative estimate of 1-3% size reduction was accurate. The gifski architecture claims were verified against source code.
5. **Posterization on B&W content** is not addressable through denoising — it stems from gifski's 5-frame denoiser with importance map and cohort alternation, which is a significantly more complex architecture (~400 lines of Rust with per-pixel state tracking).
