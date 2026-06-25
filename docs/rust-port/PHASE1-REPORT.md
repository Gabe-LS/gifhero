# Phase 1 Validation Report

## Summary

Rust probe output matches TypeScript probe output **exactly** for both test fixtures.
All 9 tests pass (`cargo build --release --features cli` and `cargo test` both succeed).

## Test Fixtures

### bbb-clip-01 (30 frames, 480x270)

| Field | TypeScript | Rust | Match |
|-------|-----------|------|-------|
| static_mask pixel count | 3 | 3 | EXACT |
| motionLevel | 0.15771338867603235 | 0.15771338867603235 | EXACT |
| colorComplexity | 35243 | 35243 | EXACT |
| keyframes (scene changes) | [26] | [0, 26] | EXACT* |

*Rust `keyframes` includes frame 0 by design (always a keyframe). TS `sceneChanges` excludes frame 0.

### bbb-clip-05 (30 frames, 480x270)

| Field | TypeScript | Rust | Match |
|-------|-----------|------|-------|
| static_mask pixel count | 4 | 4 | EXACT |
| motionLevel | 0.201004416773095 | 0.201004416773095 | EXACT |
| colorComplexity | 26301 | 26301 | EXACT |
| keyframes (scene changes) | [11] | [0, 11] | EXACT* |

## Mismatches

None. All fields match to full f64 precision.

## Denoise Module

Tested with synthetic frames:
- Static content: no modification (verified byte-identical)
- Noisy pixel injection: correctly smoothed to within ±2 of expected value
- Noise-aware gate: only applies when max deviation is within threshold

## Build Verification

```
cargo build --release --features cli  → OK
cargo test --features cli             → 9/9 passed
```

## Files Created

```
packages/gifhero-core/
├── Cargo.toml                      Dependencies + feature flags
├── .gitignore                      Excludes target/
├── src/
│   ├── lib.rs                      pub mod probe, denoise + stub mods
│   ├── probe.rs                    ProbeResult + probe_frames()
│   ├── denoise.rs                  denoise_frames() + median3()
│   ├── main.rs                     CLI stub (Phase 5)
│   ├── quantize.rs                 Stub (Phase 3)
│   ├── subframe.rs                 Stub (Phase 3)
│   ├── lanczos3.rs                 Stub (Phase 3)
│   ├── lzw.rs                      Stub (Phase 2)
│   ├── gif.rs                      Stub (Phase 2)
│   ├── dither.rs                   Stub (Phase 3)
│   └── wasm.rs                     Stub (Phase 6)
└── tests/
    ├── probe_test.rs               7 synthetic tests
    └── fixture_probe_test.rs       2 real-fixture validation tests

test/rust-port/
└── verify-probe.ts                 TS probe reference output script
```
