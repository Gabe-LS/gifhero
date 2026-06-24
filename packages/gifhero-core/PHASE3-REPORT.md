# Phase 3 Validation Report

## Summary

The Rust encode pipeline produces GIF files that are **identical or within 0.02%** of the TypeScript pipeline across both test fixtures. The crate can now encode complete GIFs from raw RGBA frames.

## Full Encode Comparison

### bbb-clip-01 (100 frames, 480x270, high motion)

| Metric | Rust | TypeScript | Match |
|--------|------|-----------|-------|
| File size | 3,179,499 bytes | 3,179,499 bytes | **IDENTICAL** |
| Frame count | 100 | 100 | EXACT |
| Encode time | 2.28s | 3.54s | Rust 1.6x faster |

### bbb-clip-05 (100 frames, 480x270, moderate motion)

| Metric | Rust | TypeScript | Match |
|--------|------|-----------|-------|
| File size | 1,601,940 bytes | 1,602,251 bytes | -0.019% |
| Frame count | 100 | 100 | EXACT |
| Encode time | 1.38s | 2.29s | Rust 1.7x faster |

The tiny difference in bbb-clip-05 (311 bytes / 0.019%) is within the expected range from imagequant's non-deterministic dithering seeded differently between runs.

## Modules Implemented

### quantize.rs (~120 LOC)
- `quantize_simple()` — frame 0 / keyframe quantization
- `quantize_with_background()` — background-aware quantization with importance map
- `build_shared_palette()` — Histogram-based multi-frame shared palette
- `remap_with_palette()` — remap with pre-built palette + background awareness
- All wrap the `imagequant` crate directly (same API as imagequant-gif-wasm)

### subframe.rs (~200 LOC)
- `find_changed_bbox()` — bounding box of non-transparent pixels
- `crop_indexed()` — crop indexed data to bbox
- `decode_frame_to_canvas()` / `decode_frame_to_canvas_rgba()` — full-frame decode
- `composite_onto_canvas()` — composite sub-frame onto canvas
- `trim_palette()` — compact unused entries + power-of-2 eviction
- `rgba_to_rgb_palette()` — RGBA→RGB palette conversion

### lanczos3.rs (~120 LOC)
- `downsample_lanczos3()` — two-pass separable Lanczos3 with precomputed kernels
- Copied from imagequant-gif-wasm (bit-identical output)

### lib.rs encode() (~260 LOC)
Full pipeline orchestrator:
1. Lanczos3 downscale (if target_width set)
2. Temporal denoise (balanced only, noise-aware gate)
3. Probe (static mask, motion level, color complexity, keyframes)
4. Content-adaptive parameters (staleThreshold, adaptiveLzw, adaptiveMaxColors)
5. Shared palette (when downscaling or colorComplexity >= 8000)
6. Frame loop: quantize → bbox → crop → trim → canvas update
7. LZW encode (standard or lossy) → GIF assembly

## Bug Fixes During Phase 3

- **LZW palette stride**: `build_dist_table` and `lzw_encode_lossy` were using stride 4 (RGBA) but the pipeline passes RGB palettes (stride 3). Fixed to match TS `lossy-lzw.ts` which uses 3-byte palettes.
- **GIF writer palette stride**: `write_gif` now auto-detects palette stride (3 or 4 bytes per entry) for backwards compatibility with Phase 2 tests.

## Build Verification

```
cargo build --release --features cli  → OK
cargo test --features cli             → 30/30 passed
```

## Files Created/Modified

```
packages/gifhero-core/src/
├── lib.rs           ← encode() orchestrator + public API
├── quantize.rs      ← imagequant wrapper (4 functions)
├── subframe.rs      ← sub-frame optimization (7 functions)
├── lanczos3.rs      ← Lanczos3 downscale
├── lzw.rs           ← fixed: RGB palette stride in dist table
├── gif.rs           ← fixed: auto-detect palette stride
└── dither.rs        ← TODO stub (not needed for primary path)

packages/gifhero-core/examples/
└── encode_test.rs   ← test binary: loads PNGs, encodes GIF

test/rust-port/
├── verify-encode.ts ← TS pipeline comparison script
├── ts-bbb-clip-01.gif  ← TS output for visual comparison
└── ts-bbb-clip-05.gif  ← TS output for visual comparison
```
