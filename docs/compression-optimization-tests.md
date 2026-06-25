# Compression Optimization Tests — 2026-06-23/24

Systematic investigation of compression levers to reduce file size while maintaining lossyLzw ≤ 5. All tests run against 25 fixtures × 4 resolutions (200 encodes) compared to gifski at default settings (quality 90).

## Starting Point

Before this session, the pipeline used:
- lossyLzw up to 6 (adaptive from complexity)
- Shared palette only when downscale ratio ≥ 2.0
- staleThreshold: `round(3 + 7 × min(1, c/5000))` with motion floor (3 or 5)
- maxColors: always 256

Results: zero >10% cases, zero VMAF losses >2, but relied on lossyLzw=6 for the hardest clips.

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total Δ |
|-----------|-----------|-----------|------------|---------|
| 480p | 15/25 | 19/25 | +0.7 | -10% |
| 360p | 15/25 | 22/25 | +0.7 | -13% |
| 240p | 18/25 | 25/25 | +1.7 | -14% |
| 160p | 19/25 | 24/25 | +2.4 | -15% |

---

## Test 1: Cap lossyLzw at 5

**Hypothesis:** lossyLzw=6 is too aggressive. Cap at 5 and find structural alternatives.

**Change:** `min(5, max(preset, round(preset + complexity / 3000)))` — was `min(6, ...)`.

**Result:** 1 regression appeared.

| Clip | Res | Before | After | gifski | Δ vs gifski |
|------|-----|--------|-------|--------|-------------|
| talking-head | 480p | 1,326KB | 1,363KB | 1,223KB | **+11%** |
| bbb-clip-08 | 480p | 6,696KB | 6,970KB | 6,514KB | +7% |
| skin-tones | 480p | 190KB | 190KB | 180KB | +6% |

**Verdict:** lossyLzw=5 cap kept. The +11% talking-head regression needed a structural fix.

---

## Test 2: Always-on shared palette

**Hypothesis:** gifski uses shared palette at all resolutions. Using shared palette always (not just when downscaling) would give cross-frame LZW consistency.

**Change:** Gate from `downscaleRatio > 1.0` to always-on when WASM available.

**Result — summary:**

| Resolution | VMAF wins | Size wins | >10% | VMAF>2 |
|-----------|-----------|-----------|------|--------|
| 480p | 9/25 | 22/25 | 0 | 0 |
| 360p | 15/25 | 22/25 | 0 | 0 |
| 240p | 18/25 | 24/25 | 0 | 0 |
| 160p | 20/25 | 24/25 | 0 | 0 |

Size wins improved at 480p (19→22), but VMAF wins dropped sharply (15→9). Per-clip analysis revealed:

| Clip | Colors | Size Δ (shared vs per-frame) | VMAF Δ | Assessment |
|------|--------|------------------------------|--------|------------|
| shapes | 3,931 | +1% | **-3.0** | Bad — no size benefit, big VMAF loss |
| bbb-clip-03 | 35,104 | -15% | -1.2 | Acceptable tradeoff |
| screencast | 283 | -53% | -0.8 | Good — massive size win |
| bbb-clip-05 | 33,373 | -3% | +0.4 | Good — VMAF gained |
| fast-action | 5,447 | +7% | +0.4 | Bad — size INCREASED |
| jellyfish | 28,002 | -0% | -0.5 | Bad — no size benefit, VMAF lost |

**Verdict:** Always-on shared palette rejected. Low-color clips (shapes, fast-action) need per-frame precision.

---

## Test 3: Conditional shared palette (colorComplexity ≥ 8000)

**Hypothesis:** Gate shared palette on color complexity. High-color clips benefit from cross-frame consistency; low-color clips don't.

**Change:** `useSharedPalette = downscaleRatio > 1.0 OR colorComplexity ≥ 8000`

**Key probe values (colorComplexity):**

| Clip | Colors | Gets shared? | Size impact | VMAF impact |
|------|--------|-------------|-------------|-------------|
| shapes | 3,931 | No (per-frame) | — | VMAF preserved |
| fast-action | 5,447 | No (per-frame) | — | VMAF preserved |
| talking-head | 9,135 | Yes | -5% | -0.4 |
| bbb-clip-08 | 39,425 | Yes | +4% | -0.0 |
| bbb-clip-01 | 59,874 | Yes | -6% | -0.3 |

**Result:** Zero >10%, zero VMAF >2. talking-head fixed (+11% → +3%).

**Verdict:** Adopted. Threshold 8000 catches clips that benefit while preserving low-color quality.

---

## Test 4: Adaptive maxColors (192 when colorComplexity ≥ 20000)

**Hypothesis:** For content with >20K distinct colors, 256 palette entries produce dithering noise that inflates LZW with negligible VMAF gain.

**Per-clip test on bbb-clip-08 (39K colors):**

| maxColors | Size | VMAF | vs gifski |
|-----------|------|------|-----------|
| 256 | 6,958KB | 98.3 | +7% |
| 192 | 6,619KB | 98.1 | +2% |
| 128 | 5,900KB | 97.9 | -9% |

**Cross-clip validation at 192 colors:**

| Clip | Colors | 256→192 size | VMAF Δ |
|------|--------|-------------|--------|
| talking-head | 9,135 | no change | 0 |
| fast-action | 5,447 | no change | 0 |
| shapes | 3,931 | no change | 0 |
| skin-tones | 614 | no change | 0 |
| jellyfish | 28,002 | -4% | — |
| city-night | 43,193 | -3% | — |

Low-color clips unaffected (they don't use all 256 entries anyway). Only high-color clips see a difference.

**Result:** bbb-clip-08 dropped from +7% to +2% vs gifski.

**Verdict:** Adopted for colorComplexity ≥ 20000.

---

## Test 5: Raised staleThreshold base (3→5)

**Hypothesis:** The old formula `round(3 + 7 × min(1, c/5000))` with a floor of 3 or 5 was too conservative for low-complexity content. Many sub-perceptual pixel changes were kept opaque.

**Per-clip threshold sweep:**

### skin-tones (complexity=3, auto-threshold was 3)

| Threshold | Size | VMAF | vs gifski size | vs gifski VMAF |
|-----------|------|------|----------------|----------------|
| 3 (auto) | 190KB | 96.7 | +6% | +0.1 |
| 6 | 130KB | 96.5 | **-28%** | -0.2 |
| 10 | 93KB | 95.4 | -48% | -1.3 |
| 15 | 74KB | 94.1 | -59% | -2.6 |

threshold=6 saves 32% at -0.2 VMAF — dramatic improvement from tiny VMAF cost.

### talking-head (complexity=826, auto-threshold was 5)

| Threshold | Size | VMAF | vs gifski size |
|-----------|------|------|----------------|
| 5 (auto) | 1,257KB | 95.6 | +3% |
| 6 | 1,148KB | 94.9 | **-6%** |
| 10 | 859KB | 91.4 | -30% |
| 15 | 664KB | 85.7 | -46% |

threshold=6 saves 9% at -0.7 VMAF — flips from +3% to -6% vs gifski.

### bbb-clip-08 (complexity=22067, auto-threshold was 10)

| Threshold | Size | VMAF |
|-----------|------|------|
| 6 | 6,820KB (+3%) | 98.4 |
| 10 (auto) | 6,619KB | 98.1 |
| 12 | 6,542KB (-1%) | 97.9 |
| 15 | 6,445KB (-3%) | 97.6 |

Already at threshold=10. Raising further gives diminishing returns.

### shapes (complexity=239, auto-threshold was 5)

| Threshold | Size | VMAF |
|-----------|------|------|
| 5 (auto) | 351KB | 92.7 |
| 6 | 335KB (-5%) | 92.0 |
| 10 | 285KB (-19%) | 90.1 |

threshold=6 saves 5% at -0.7 VMAF — modest but clean.

**New formula:** `round(5 + 5 × min(1, c/5000))`, no motion floor.

| Complexity | Old threshold | New threshold |
|-----------|--------------|---------------|
| 0 (static) | 3 | 5 |
| 500 | 4 | 5 |
| 1000 | 4-5 | 6 |
| 2500 | 7 | 8 |
| 5000+ | 10 | 10 |

**Batch result — per-clip changes at 480p:**

| Clip | Old size | New size | Δ | Old VMAF | New VMAF | Δ | vs gifski |
|------|----------|----------|---|----------|----------|---|-----------|
| screencast | 25KB | 19KB | -24% | 97.6 | 97.4 | -0.2 | -0.1 |
| skin-tones | 190KB | 145KB | -24% | 97.2 | 97.1 | -0.1 | -0.0 |
| bbb-clip-04 | 1,802KB | 1,541KB | -14% | 96.1 | 95.3 | -0.9 | -0.1 |
| sintel | 1,307KB | 1,193KB | -9% | 98.3 | 97.7 | -0.6 | +0.4 |
| talking-head | 1,257KB | 1,148KB | -9% | 95.9 | 95.3 | -0.6 | +0.3 |
| bbb-clip-02 | 3,375KB | 3,132KB | -7% | 95.1 | 94.2 | -0.9 | +0.7 |
| fast-action | 3,204KB | 3,070KB | -4% | 99.3 | 98.7 | -0.5 | +2.4 |

**Aggregate impact:**

| Resolution | Old total | New total | Savings |
|-----------|----------|----------|---------|
| 480p | 55.2 MB | 54.2 MB | -1.9% |
| 360p | 32.8 MB | 32.2 MB | -1.9% |
| 240p | 15.6 MB | 15.2 MB | -2.5% |
| 160p | 7.9 MB | 7.7 MB | -2.7% |

**Verdict:** Adopted. 2-3% savings across all resolutions, zero violations.

---

## Test 6: Dithering level on shared palette remap

**Hypothesis:** Reducing Floyd-Steinberg dithering strength from 1.0 to 0.85 or lower would produce simpler patterns that compress better with LZW.

**Method:** Changed `remapWithPalette(…, dither)` parameter.

**Results at dither=0.85:**

Total size change across all resolutions: **< 0.1%** (unmeasurable).

**Results at dither=0.5:**

| Clip | dither=1.0 | dither=0.5 | Δ | VMAF Δ |
|------|-----------|-----------|---|--------|
| talking-head | 1,148KB | 1,129KB | -2% | -0.4 |
| bbb-clip-08 | 6,619KB | 6,617KB | 0% | 0 |
| bbb-clip-01 | 3,233KB | 3,197KB | -1% | 0 |
| jellyfish | 2,568KB | 2,525KB | -2% | -0.1 |

Even at dither=0.0 (no dithering at all): only 1-2% savings.

**Why:** Background-aware remapping already produces clean output. Most pixels per frame are transparent (unchanged). The remaining opaque pixels are in genuinely changed regions where dithering is minimal.

**Verdict:** Rejected. Negligible impact.

---

## Test 7: imagequant speed parameter

**Hypothesis:** Higher speed (3-5 instead of 1) produces simpler dithering patterns that compress better.

**Results on bbb-clip-08:**

| Speed | Size | VMAF |
|-------|------|------|
| 1 (default) | 6,958KB | 98.3 |
| 3 | 6,962KB | — |
| 5 | 6,972KB | — |

Size actually *increased* slightly at higher speed.

**Why:** Speed controls quantization iteration count, not output pattern complexity. Higher speed makes the palette slightly worse, which increases dithering artifacts.

**Verdict:** Rejected. No benefit.

---

## Test 8: Shared palette for frame 0

**Hypothesis:** Frame 0 uses `quantizeSimple()` (its own palette) even when shared palette is active. Using shared palette for frame 0 would give one fewer LCT and better LZW alignment with subsequent frames.

**Change:** Added `gifRemapPalette(frame0, …, sharedPalette, emptyCanvas)` path for frame 0.

**Results:**

| Clip | Per-frame f0 | Shared f0 | Δ size | Δ VMAF |
|------|-------------|-----------|--------|--------|
| talking-head | 1,148KB | 1,147KB | -0.1% | -0.5 |
| bbb-clip-08 | 6,619KB | 6,579KB | -0.6% | 0 |
| jellyfish | 2,568KB | 2,569KB | 0% | 0 |
| shapes | 351KB | 351KB | 0% | 0 |

**Why:** Frame 0 is one frame out of 60-100. The palette savings (768 bytes) and marginal LZW alignment improvement are dwarfed by the total file size. Meanwhile, frame 0 gets a suboptimal palette (shared palette is a cross-frame compromise, not optimized for frame 0's content).

**Verdict:** Rejected. 0.1-0.6% savings at -0.5 VMAF cost.

---

## Test 9: q80 palette building quality

**Hypothesis:** Building the shared palette at quality=80 instead of 90 produces a more "generalized" palette that maps more consistently across frames.

**Per-clip results (shared palette built at q80):**

| Clip | Colors | q90 size | q80 size | Δ | VMAF Δ |
|------|--------|---------|---------|---|--------|
| talking-head | 9,135 | 1,148KB | 978KB | -15% | -1.0 |
| jellyfish | 28,002 | 2,568KB | 2,446KB | -5% | -0.3 |
| bbb-clip-08 | 39,425 | 6,619KB | 6,619KB | 0% | 0 |
| bbb-clip-01 | 59,874 | 3,233KB | 3,233KB | 0% | 0 |

Significant savings on mid-color clips, but zero effect on high-color clips (palette is already heavily quantized at 192 entries).

**Full batch result:** 6 VMAF violations >2 points:

| Clip | Res | VMAF Δ vs gifski | Size Δ |
|------|-----|------------------|--------|
| shapes | 360p | **-5.2** | -10% |
| shapes | 160p | **-4.5** | -39% |
| shapes | 240p | **-3.1** | -29% |
| candle-flame | 160p | **-2.6** | -69% |
| screencast | 160p | **-2.4** | -80% |
| skin-tones | 160p | **-2.1** | -66% |

Low-color clips are devastated because q80 drops critical palette entries they need.

**Verdict:** Rejected. Size savings real (4-6% at lower resolutions) but VMAF violations unacceptable.

---

## Test 10: imagequant quality per-clip sweep

**Context:** Tested to understand the quality parameter's impact, not as a direct implementation candidate.

### talking-head at 480p

| Quality | Size | VMAF |
|---------|------|------|
| 90 | 1,257KB | 95.6 |
| 85 | 1,144KB | 95.1 |
| 80 | 1,116KB | 94.6 |
| 70 | 997KB | 93.7 |

Each 5-point quality reduction saves 5-10% size at 0.5 VMAF cost.

### bbb-clip-08 at 480p

| Quality | Size | VMAF |
|---------|------|------|
| 90 | 6,619KB | 98.1 |
| 85 | 6,619KB | 98.1 |
| 80 | 6,619KB | 98.1 |
| 70 | 6,331KB | 98.0 |

No effect at q85/q80 for high-color content with shared palette — palette is already constrained to 192 colors.

### jellyfish at 480p

| Quality | Size | VMAF |
|---------|------|------|
| 90 | 2,568KB | 95.4 |
| 85 | 2,567KB | 95.5 |
| 80 | 2,441KB | 95.1 |
| 70 | 2,127KB | 94.8 |

**Takeaway:** Quality is a powerful lever but can't be reduced globally without hurting low-color clips. Content-adaptive quality would require per-clip profiling that adds complexity without clear ROI beyond what threshold tuning already achieves.

---

## Final State

All adopted changes together:

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total Δ | >10% | VMAF>2 |
|-----------|-----------|-----------|------------|---------|------|--------|
| **480p** | 9/25 | **24/25** | +0.3 | **-16%** | 0 | 0 |
| **360p** | 12/25 | **24/25** | +0.5 | **-16%** | 0 | 0 |
| **240p** | 15/25 | **25/25** | +1.4 | **-17%** | 0 | 0 |
| **160p** | 20/25 | **25/25** | +2.3 | **-17%** | 0 | 0 |

**Zero cases >5% larger than gifski.** lossyLzw never exceeds 5.

### Progression from baseline to final

| Metric | Baseline (lzw≤6) | Final (lzw≤5) | Change |
|--------|-----------------|---------------|--------|
| 480p size wins | 19/25 | 24/25 | +5 |
| 480p total size | -10% | -16% | -6pp |
| 360p total size | -13% | -16% | -3pp |
| 240p total size | -14% | -17% | -3pp |
| 160p total size | -15% | -17% | -2pp |
| Worst case vs gifski | 0% (none >10%) | 0% (none >5%) | improved |

### Key clip progression (480p)

| Clip | Baseline | → lzw5 cap | → +cond shared | → +adaptive mc | → +threshold 5 | gifski |
|------|----------|-----------|----------------|----------------|----------------|--------|
| talking-head | 1,326KB | 1,363KB (+11%) | 1,257KB (+3%) | 1,257KB (+3%) | 1,148KB (-6%) | 1,223KB |
| bbb-clip-08 | 6,696KB | 6,970KB (+7%) | 6,958KB (+7%) | 6,619KB (+2%) | 6,619KB (+2%) | 6,514KB |
| skin-tones | 190KB | 190KB (+6%) | 190KB (+6%) | 190KB (+6%) | 145KB (-19%) | 180KB |
| bbb-clip-02 | 3,938KB | 3,375KB (-11%) | 3,375KB (-11%) | 3,375KB (-11%) | 3,132KB (-18%) | 3,806KB |

### What worked

| Optimization | Size impact | VMAF cost | Mechanism |
|-------------|------------|-----------|-----------|
| Conditional shared palette | Eliminates >10% cases | -0.2 to -0.4 | Cross-frame LZW consistency |
| Adaptive maxColors (192) | -5% on high-color clips | -0.2 | Less dithering noise |
| staleThreshold base 5 | -2-3% across the board | -0.1 to -0.9 | More transparent pixels |
| lossyLzw cap at 5 | n/a (constraint) | +0.5 (quality gain) | Gentler lossy compression |

### What didn't work

| Optimization | Size impact | Why rejected |
|-------------|------------|-------------|
| Dithering level 0.85 | < 0.1% | Background-aware pipeline already clean |
| Dithering level 0.0 | 1-2% | Negligible; VMAF cost not justified |
| imagequant speed 3-6 | 0% (slightly worse) | Speed doesn't simplify output patterns |
| Shared palette for frame 0 | 0.1-0.6% | -0.5 VMAF; frame 0 needs its own palette |
| q80 palette building | 4-6% at lower res | 6 VMAF violations >2 on low-color clips |
| Always-on shared palette | Varies | shapes -3.0 VMAF with zero size benefit |
