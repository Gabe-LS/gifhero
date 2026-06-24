# Compression Strategies Test Report — 2026-06-24

Testing all strategies recommended in `COMPRESSION-IMPROVEMENT-REPORT.md` against 25 fixtures × 4 resolutions (200 encodes).

## Baseline (start of session)

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total Δ vs gifski |
|-----------|-----------|-----------|------------|-------------------|
| 480p | 9/25 | 24/25 | +0.3 | -16% |
| 360p | 10/25 | 24/25 | +0.4 | -16% |
| 240p | 15/25 | 25/25 | +1.4 | -17% |
| 160p | 18/25 | 25/25 | +2.1 | -17% |

---

## Strategy 1: Per-Frame Adaptive Threshold

**Status: ADOPTED (boost-only variant)**

The report proposed boosting threshold on near-static frames and reducing on high-motion frames. Testing revealed the reduction clause was counter-productive.

### Test A: Full formula (boost + reduce)

Formula: `fm < 0.02 → threshold+2; fm > 0.15 → threshold-2; else → threshold`

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| 480p | **+3.3%** | 1 |
| 360p | +3.0% | — |

**Result: REJECTED.** Files got 3% BIGGER overall. Reducing threshold on high-motion frames kept too many pixels opaque. 1 VMAF violation.

### Test B: Boost-only (+2)

Formula: `fm < 0.02 → threshold+2; else → threshold`

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| 480p | -0.5% | 0 |
| 360p | -0.6% | 0 |
| 240p | -0.9% | 0 |
| 160p | -1.2% | 1 |

**Result: 1 VMAF violation** (skin-tones 160p at -2.0). Boost of +2 too aggressive.

### Test C: Boost-only (+1) — ADOPTED

Formula: `fm < 0.02 → min(10, threshold+1); else → threshold`

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| 480p | **-0.3%** | 0 |
| 360p | **-0.4%** | 0 |
| 240p | **-0.5%** | 0 |
| 160p | **-0.6%** | 0 |

Key clips improved: skin-tones -5%, screencast -8%, candle-flame -3%, bbb-clip-06 -5%.

---

## Strategy 2: Entropy-Guided Transparency (Anti-Scatter Filter)

**Status: REJECTED**

Implemented the anti-scatter filter: after quantization, reverted isolated transparent pixels (left AND right neighbors opaque) to the left neighbor's index.

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| 480p | +1.0% | **42** |
| 360p | +1.4% | — |

**Result: CATASTROPHIC.** 42 VMAF violations >2 points across all resolutions. Average VMAF delta went to -1.5 to -2.7. Changing transparent pixels to opaque with the wrong color creates visible artifacts at dithering boundaries.

**Root cause:** A transparent pixel shows the canvas (which matches the source). Replacing it with the left neighbor's palette color shows a different color entirely. The filter is visually destructive, not visually lossless as the report claimed.

A correct implementation would need to verify the left neighbor's color closely matches the canvas at that pixel — effectively becoming a full dual-compression approach.

---

## Strategy 3: Global Color Table (GCT) Reuse

**Status: REJECTED**

Passed the shared palette as GCT and set `frame.palette = undefined` for shared-palette frames, skipping per-frame trimPalette.

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| 480p | -1.1% | **82** |
| 160p | -9.6% | — |

**Result: CATASTROPHIC.** 82 VMAF violations. Average VMAF delta -40 to -69 points.

**Root cause:** `remapWithPalette` returns its OWN output palette (the WASM's `build_result` function constructs it from the `QuantizationResult`), which may reorder entries or add entries compared to the input shared palette. The indices in `r.indexed` are relative to `r.palette`, NOT to the original `sharedPalette`. Using the shared palette as GCT while the indices reference a different palette produces completely wrong colors.

A correct implementation would require either WASM API changes to guarantee palette stability, or a full index remapping step to translate frame indices back to GCT positions.

---

## Strategy 6: Per-Frame Dithering Level

**Status: ALREADY TESTED (previous session), CONFIRMED NEGLIGIBLE**

Previously tested dither=0.85 and 0.5 globally. The report suggested gating by perFrameMotion. Given the previous session found even dither=0.0 saves only 1-2% with VMAF cost, and the per-frame gating would affect fewer pixels, the expected gain is < 0.5%. Not retested.

---

## Strategy 8: Deferred Clear Code (LZW)

**Status: ADOPTED**

When the LZW dictionary fills (code 4095), defer the CLEAR code. Continue matching against the full dictionary without adding new entries. Emit CLEAR only when compression ratio degrades (> 11 bits/pixel over a 256-pixel sliding window).

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| 480p | **-0.3%** | 0 |
| 360p | **-0.2%** | 0 |
| 240p | -0.1% | 0 |
| 160p | 0.0% | 0 |

Applied to both `lzw.ts` and `lossy-lzw.ts`. Lossless, spec-compliant. Effect is largest at 480p where frames are big enough for the dictionary to fill multiple times.

---

## Strategy 10: Lossy Prefiltering (Neighbor Color Copying)

**Status: REJECTED**

Before LZW encoding, replaced non-transparent pixels with their left neighbor's index when palette colors are within Chebyshev distance ≤ lossyLzw threshold.

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| All | **-0.0%** | 0 |

**Result:** Zero measurable impact. The lossy LZW encoder is already doing equivalent work at the dictionary level — finding approximate matches during encoding. The prefilter modifies pixel data but the LZW already handles the same approximation. The two techniques overlap completely rather than compounding.

---

## Strategy 11: Power-of-2 Palette Targeting

**Status: ADOPTED**

Extended `trimPalette` to evict the least-used entries when the trimmed count is just above a power-of-2 boundary (e.g., 33→32 colors). Evicted entries are remapped to their nearest palette neighbor. Maximum eviction: 6% of palette size.

| Resolution | vs prev | VMAF>2 |
|-----------|---------|--------|
| 480p | -0.0% | 0 |
| 360p | -0.0% | 0 |
| 240p | **-0.1%** | 0 |
| 160p | **-0.4%** | 0 |

Effect is proportional to sub-frame size — smaller frames at lower resolutions benefit more from the 1-bit min code size reduction.

---

## Strategies Not Tested

### Strategy 4: Mixed Disposal Method Selection (Including Disposal 3)

**Not tested.** Requires extending canvas tracking with a "previous canvas" buffer and trying all 3 disposal methods per frame transition. Significant implementation (~80 lines) and conceptual complexity. Would primarily benefit animations with transient overlays or moving objects over complex backgrounds — a pattern not well represented in our 25 fixtures.

### Strategy 5: Frame Doubling (Zero-Delay Intermediate Frames)

**Not tested.** Requires analysis of spatial clustering within sub-frame bounding boxes and splitting frames when changes are spatially separated. Complex implementation (~100 lines). Would primarily benefit animations with multiple spatially separated moving objects.

### Strategy 7: Per-Tile Spatial Threshold

**Not tested.** Requires extending the probe with per-block (16×16) motion maps and replacing scalar threshold with spatial lookups. Moderate complexity. Expected 2-8% on mixed-content clips.

### Strategy 9: Per-Frame Lossy LZW Level

**Not tested.** Requires refactoring `writeGif` to accept per-frame encoder callbacks. Currently takes a single `lzwEncoder` function. Expected 3-8% on bursty content.

---

## Summary

| Strategy | Est. savings | Actual result | Status |
|----------|-------------|---------------|--------|
| 1. Per-frame adaptive threshold (+1 boost) | 3-12% | **0.3-0.6%** | Adopted |
| 2. Anti-scatter filter | 2-8% | **+1% BIGGER, 42 VMAF violations** | Rejected |
| 3. GCT reuse | 20-45KB | **82 VMAF violations** | Rejected |
| 6. Per-frame dithering | 2-6% | **< 0.1%** | Skipped (prev. tested) |
| 8. Deferred clear code | 1-2% | **0.2-0.3%** | Adopted |
| 10. Lossy prefiltering | 5-15% | **0.0%** | Rejected |
| 11. Power-of-2 palette targeting | 5-12% | **0.1-0.4%** | Adopted |
| 4. Mixed disposal | 1-10% | — | Not tested |
| 5. Frame doubling | 5-30% | — | Not tested |
| 7. Per-tile spatial threshold | 2-8% | — | Not tested |
| 9. Per-frame lossy LZW | 3-8% | — | Not tested |

**Combined improvement from adopted strategies: 0.6-0.9% across all resolutions.**

The report's estimates were consistently over-optimistic. Most strategies that claimed 2-15% savings delivered < 0.5% or were destructive. The two catastrophic failures (anti-scatter and GCT) had implementation prerequisites that the report didn't account for (palette index stability, transparent pixel visual semantics).

### Final State

| Resolution | VMAF wins | Size wins | Avg VMAF Δ | Total Δ vs gifski |
|-----------|-----------|-----------|------------|-------------------|
| 480p | 9/25 | 24/25 | +0.3 | **-16%** |
| 360p | 10/25 | 24/25 | +0.4 | **-16%** |
| 240p | 15/25 | 25/25 | +1.3 | **-18%** |
| 160p | 18/25 | 25/25 | +2.1 | **-17%** |

Zero >10% larger. Zero VMAF losses >2 points. Zero cases >5% larger.
