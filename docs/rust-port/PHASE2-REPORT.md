# Phase 2 Validation Report

## Summary

All Rust LZW and GIF output is **byte-identical** to TypeScript for every test case. 30/30 tests pass. `cargo build --release --features cli` and `cargo test` both succeed.

## LZW Cross-Validation (8 test cases)

### Standard LZW

| Test Case | Input | minCodeSize | TS bytes | Rust bytes | Byte-identical |
|-----------|-------|-------------|----------|------------|----------------|
| solid-4x4-idx0 | 16 × 0 | 2 | 4 | 4 | YES |
| alternating-4colors | [0,1,2,3]×4 | 2 | 6 | 6 | YES |
| gradient-256 | 0..255 | 8 | 291 | 291 | YES |
| repetitive-1000 | i%64, 1000 px | 7 | 355 | 355 | YES |
| large-repetitive-5000 | i%32, 5000 px | 5 | 586 | 586 | YES |

The 5000-pixel case exercises deferred clear code logic (dictionary fills and re-evaluates compression ratio over 256-pixel windows).

### Lossy LZW

| Test Case | Input | Lossiness | TS bytes | Rust bytes | Byte-identical |
|-----------|-------|-----------|----------|------------|----------------|
| lossy-zero | i%16, 100 px | 0 | 37 | 37 | YES |
| lossy-20 | i%16, 1000 px | 20 | 151 | 151 | YES |
| lossy-5 | i%8, 500 px | 5 | 69 | 69 | YES |

Lossy-zero produces output identical to standard LZW (verified both in TS and Rust).

## GIF Cross-Validation (2 test cases)

### Test 1: 2-frame solid GIF (4×4, 4-color palette)

| Property | TypeScript | Rust | Match |
|----------|-----------|------|-------|
| File size | 107 bytes | 107 bytes | EXACT |
| Byte-identical | — | — | YES |

### Test 2: 1-frame transparent GIF (2×2, 5-color palette, transparentIndex=4)

| Property | TypeScript | Rust | Match |
|----------|-----------|------|-------|
| File size | 81 bytes | 81 bytes | EXACT |
| Byte-identical | — | — | YES |

Both GIF files are byte-identical: headers, Netscape extension, GCE, image descriptors, local color tables (RGBA→RGB stripping + power-of-2 padding), LZW data sub-blocks, and trailer all match exactly.

## Mismatches

None across all 10 cross-validation tests.

## Implementation Details

### lzw.rs (220 LOC)
- `lzw_encode()`: standard GIF LZW with deferred clear (256-pixel window, 11 bpp threshold)
- `lzw_encode_lossy()`: Chebyshev distance-based approximate dictionary matching
- `build_dist_table()`: 256×256 palette distance table from RGBA palette

### gif.rs (130 LOC)
- `GifFrame` struct with RGBA palette, millisecond delay, bbox offsets
- `write_gif()`: GIF89a header, Netscape extension, per-frame GCE + LCT + LZW sub-blocks
- `compute_min_code_size()`: consistent palette→LZW sizing
- RGBA→RGB stripping for Local Color Table entries
- Power-of-2 palette padding (minimum 4 entries)
- ms→centisecond delay conversion with rounding

## Build Verification

```
cargo build --release --features cli  → OK
cargo test --features cli             → 30/30 passed
```

## Test Breakdown

| Test File | Tests | Description |
|-----------|-------|-------------|
| probe_test.rs | 7 | Phase 1: synthetic probe + denoise |
| fixture_probe_test.rs | 2 | Phase 1: real fixture probe validation |
| gif_test.rs | 11 | LZW + GIF unit tests |
| lzw_crossval_test.rs | 8 | LZW byte-identical cross-validation |
| gif_crossval_test.rs | 2 | GIF byte-identical cross-validation |

## Files Created/Modified

```
packages/gifhero-core/src/
├── lib.rs         ← updated: pub mod lzw, gif
├── lzw.rs         ← NEW: lzw_encode() + lzw_encode_lossy()
└── gif.rs         ← NEW: GifFrame + write_gif() + compute_min_code_size()

packages/gifhero-core/tests/
├── gif_test.rs           ← NEW: 11 unit tests
├── lzw_crossval_test.rs  ← NEW: 8 byte-identical cross-validation tests
└── gif_crossval_test.rs  ← NEW: 2 byte-identical GIF cross-validation tests

test/rust-port/
├── verify-lzw.ts  ← NEW: TS LZW reference output
└── verify-gif.ts  ← NEW: TS GIF reference output
```
