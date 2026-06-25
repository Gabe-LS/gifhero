# Rust Port — Phase 1 Prompt

Copy this entire message into a new Claude Code chat in the gifhero project directory.

---

## Rules

1. **Before writing any code**, create a new branch: `git checkout -b rust-port-phase1`
2. **Do not ask me questions.** Make reasonable decisions and keep going.
3. **Commit after each step** with a descriptive message.
4. When done, write a validation report to `packages/gifhero-core/PHASE1-REPORT.md` comparing the Rust probe output against the TypeScript probe output for at least 2 test fixtures. Include exact values for: static_mask pixel counts, motionLevel, colorComplexity, keyframe indices. Flag any mismatches.

## Context

gifhero is a TypeScript GIF encoding library. We're porting the entire encoding pipeline to Rust so it can compile to both a native CLI (with Rayon multi-threading) and WASM (for the existing browser SDK). The full plan with every algorithm in pseudocode is in `RUST-PORT-PLAN.md` — read it completely before starting.

There's already a Rust crate at `packages/imagequant-gif-wasm/` that handles quantization and Lanczos3 downscaling. We're creating a NEW crate `packages/gifhero-core/` that will contain the full pipeline and eventually replace the old one.

## What to do

**Phase 1: Create the gifhero-core crate with probe + denoise modules.**

### Step 1: Create the crate

Create `packages/gifhero-core/` with the Cargo.toml from the plan. For now only implement `lib.rs`, `probe.rs`, and `denoise.rs`. Leave `main.rs`, `wasm.rs`, and other modules as empty stubs with TODO comments.

The Cargo.toml should have:
- `imagequant = { version = "4", default-features = false }`
- `rayon = { version = "1", optional = true }`
- `wasm-bindgen = { version = "0.2", optional = true }`
- Features: `cli = ["rayon"]`, `wasm = ["wasm-bindgen"]`
- `crate-type = ["cdylib", "rlib"]`
- Release profile: `opt-level = 2`, `lto = true`

### Step 2: Implement probe.rs

Port the probe algorithm from `src/probe.ts`. The Rust function signature should be:

```rust
pub struct ProbeResult {
    pub static_mask: Vec<u8>,      // 1 = static pixel, 0 = dynamic
    pub motion_level: f64,          // average fraction of pixels changing per frame
    pub color_complexity: usize,    // distinct 6-bit-quantized colors
    pub keyframes: Vec<usize>,      // frame indices that are keyframes
}

pub fn probe_frames(
    frames: &[&[u8]],  // slice of RGBA frame data
    width: usize,
    height: usize,
    tolerance: u8,      // default 3
) -> ProbeResult
```

The algorithm is specified exactly in `RUST-PORT-PLAN.md` under "Probe Algorithm Detail". Follow it precisely — same thresholds (tolerance=3, motion threshold=5, scene change=0.6, motion-to-static: >0.15 then <0.02), same 6-bit color quantization, same sampling strategy (every 5th frame for color complexity).

### Step 3: Implement denoise.rs

Port the temporal denoiser from the plan's "Temporal Denoiser Detail":

```rust
pub fn denoise_frames(
    frames: &mut [Vec<u8>],  // mutable RGBA frame data
    width: usize,
    height: usize,
    threshold: u8,           // default 3
)
```

3-frame temporal median filter. For each pixel in frames 1..n-1, compute median of (prev, curr, next) per channel, clamp to within ±threshold of original. Skip alpha channel.

### Step 4: Verify against TypeScript

Write a test script `packages/gifhero-core/tests/probe_test.rs` that:
1. Creates synthetic test frames (e.g., 64x64, 10 frames with a moving block)
2. Runs `probe_frames` and asserts expected values for static_mask, motion_level, keyframes

Also write a Node.js script `test/rust-port/verify-probe.ts` that:
1. Loads real test fixture frames from `test/fixtures/candle-flame/` (or another fixture)
2. Runs the TS `probeFrames()` and prints the results as JSON
3. This output will be used to validate the Rust implementation matches

Build the crate with `cargo build` (not wasm-pack yet — just verify it compiles as a native library).

### Step 5: Verify the build

```bash
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

Both must pass.

## What NOT to do

- Don't port the sub-frame pipeline, LZW, GIF writer, or dithering yet — those are phases 2-3.
- Don't set up wasm-pack or WASM builds yet — that's phase 6.
- Don't modify any existing TypeScript code.
- Don't modify the existing `packages/imagequant-gif-wasm/` crate.
- Don't add `clap` or CLI argument parsing yet — that's phase 5.

## Files to create

```
packages/gifhero-core/
├── Cargo.toml
├── src/
│   ├── lib.rs         ← pub mod probe; pub mod denoise; (+ empty stubs for future modules)
│   ├── probe.rs       ← ProbeResult + probe_frames()
│   ├── denoise.rs     ← denoise_frames()
│   ├── quantize.rs    ← // TODO: Phase 3
│   ├── subframe.rs    ← // TODO: Phase 3
│   ├── lanczos3.rs    ← // TODO: Phase 3 (move from imagequant-gif-wasm)
│   ├── lzw.rs         ← // TODO: Phase 2
│   ├── gif.rs         ← // TODO: Phase 2
│   ├── dither.rs      ← // TODO: Phase 3
│   ├── wasm.rs        ← // TODO: Phase 6
│   └── main.rs        ← // TODO: Phase 5
└── tests/
    └── probe_test.rs

test/rust-port/
└── verify-probe.ts
```

## Reference files to read

- `RUST-PORT-PLAN.md` — complete algorithm specifications (READ THIS FIRST)
- `CLAUDE.md` — project conventions and architecture overview
- `src/probe.ts` — TypeScript probe implementation to match
- `src/index.ts` lines 1085-1122 — denoiseFrames implementation
- `packages/imagequant-gif-wasm/Cargo.toml` — reference for Cargo.toml structure
