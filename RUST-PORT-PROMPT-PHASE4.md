# Rust Port — Phase 4 Prompt

Copy this entire message into a new Claude Code chat in the gifhero project directory.

---

## Rules

1. **Before writing any code**: `git checkout rust-port-phase3 && git checkout -b rust-port-phase4`
2. **Do not ask me questions.** Make reasonable decisions and keep going.
3. **Commit after each step** with a descriptive message.
4. When done, write a validation report to `packages/gifhero-core/PHASE4-REPORT.md`. Run the same 2 test fixtures from Phase 3 with both single-threaded and Rayon-parallel encode. Report: encode times (single vs parallel), speedup ratio, file size comparison (must be within ±1% of single-threaded), thread count used. Also note any quality differences.

## Context

gifhero is a TypeScript GIF encoding library being ported to Rust. The full plan is in `RUST-PORT-PLAN.md`.

**Phase 1-3** (done): the Rust crate at `packages/gifhero-core/` can produce complete GIF files from raw RGBA frames. Single-threaded encode is already 1.7× faster than the TypeScript WASM pipeline. Phase 3 validated byte-identical or within 0.02% of TypeScript output.

**Phase 4** (this phase): add Rayon parallelism to make the encode pipeline use all CPU cores. Target: ~3-4s for 333 frames at 1080p→480p (matching or beating gifski CLI's 4s).

## What to do

### Step 1: Add an `encode_parallel` function to lib.rs

Create a new public function alongside the existing sequential `encode`:

```rust
/// Parallel encode using Rayon. Same output quality as encode(),
/// with multi-core speedup on Lanczos3, quantization, and LZW.
#[cfg(feature = "cli")]
pub fn encode_parallel(frames: &[EncodeFrame], opts: &EncodeOptions) -> Vec<u8>
```

Gate it behind `#[cfg(feature = "cli")]` since Rayon isn't available in the WASM target.

### Step 2: Parallelize Lanczos3 downscale

All frames are independent — trivially parallel:

```rust
use rayon::prelude::*;

let resized: Vec<Vec<u8>> = frames.par_iter()
    .map(|f| downsample_lanczos3(&f.data, src_w, src_h, dst_w, dst_h))
    .collect();
```

### Step 3: Keep denoise + probe + palette build sequential

These are fast (~100ms total) and have cross-frame dependencies. Not worth parallelizing:
- Denoise: reads frames[i-1], [i], [i+1]
- Probe: accumulates min/max across all frames
- Shared palette: pools sampled frames into one Histogram

### Step 4: Parallelize quantization

When using a shared palette, each frame's `remap_with_palette` call is independent — it only needs the frame data, the shared palette, and a background. The true background (decoded canvas) depends on previous frames, but we can approximate:

**Canvas approximation strategy** (validated in the TS pipeline — no VMAF impact):
- Frame 0: empty canvas (all zeros)
- Frame N (N>0): use the SOURCE pixels of frame N-1 as the approximate canvas
- At keyframes (scene changes): reset to empty canvas

```rust
// Pre-compute approximate canvases
let mut approx_canvases: Vec<Vec<u8>> = Vec::with_capacity(frames.len());
approx_canvases.push(vec![0u8; num_pixels * 4]); // frame 0: empty
for i in 1..frames.len() {
    if scene_changes.contains(&i) {
        approx_canvases.push(vec![0u8; num_pixels * 4]);
    } else {
        approx_canvases.push(frames[i - 1].data.clone());
    }
}

// Parallel quantize (all frames except frame 0 / keyframes use remap)
let quant_results: Vec<QuantResult> = (0..frames.len()).into_par_iter()
    .map(|i| {
        let input_rgba = prepare_input(&frames[i].data, &static_mask, &approx_canvases[i], frame_threshold);
        if scene_changes.contains(&i) || i == 0 {
            quantize_simple(&frames[i].data, width, height, 0, quality, speed, max_colors)
        } else if shared_palette.is_some() {
            remap_with_palette(&input_rgba, width, height, shared_palette.unwrap(), &approx_canvases[i], 1.0)
        } else {
            quantize_with_background(&input_rgba, width, height, &approx_canvases[i], &importance_map, 0, quality, speed, max_colors)
        }
    })
    .collect();
```

The `prepare_input` function handles alpha zeroing (static mask + stale threshold) — same logic as the sequential path but using the approximate canvas instead of the true decoded canvas.

### Step 5: Sequential sub-frame pass

After parallel quantization, the sub-frame pass (bbox, crop, trim, canvas update) MUST be sequential because each frame's canvas depends on the previous frame's composited output:

```rust
let mut canvas = vec![0u8; num_pixels * 4];
let mut gif_frames: Vec<GifFrame> = Vec::with_capacity(frames.len());

for i in 0..frames.len() {
    let qr = &quant_results[i];
    
    if i == 0 || scene_changes.contains(&i) {
        // Full frame, decode to canvas
        let trimmed = trim_palette(...);
        decode_frame_to_canvas(&mut canvas, &trimmed.indexed, &qr.palette, width, height);
        gif_frames.push(full_frame(...));
    } else {
        // Find bbox, crop, trim, composite
        let bbox = find_changed_bbox(&qr.indexed, width, height, qr.transparent_index);
        // ... crop, trim, build GifFrame
        composite_onto_canvas(&mut canvas, &qr.indexed, &qr.palette, qr.transparent_index, ...);
        gif_frames.push(sub_frame(...));
    }
}
```

### Step 6: Parallelize LZW encoding

After the sub-frame pass produces final indexed data + palettes for each frame, LZW encoding is per-frame with no dependencies:

```rust
let lzw_data: Vec<Vec<u8>> = gif_frames.par_iter()
    .map(|frame| {
        let padded = pad_to_pow2(frame.palette_count);
        let min_code_size = std::cmp::max(2, (padded as f64).log2() as u8);
        if adaptive_lzw > 0 {
            lzw_encode_lossy(&frame.indexed, min_code_size, &frame.palette, frame.palette_count, adaptive_lzw)
        } else {
            lzw_encode(&frame.indexed, min_code_size)
        }
    })
    .collect();
```

### Step 7: Sequential GIF assembly

```rust
write_gif(width as u16, height as u16, &gif_frames, &lzw_data)
```

### Step 8: Benchmark

Update the `examples/encode_test.rs` from Phase 3 to support both modes:

```bash
# Single-threaded
cargo run --example encode_test --features cli -- test/fixtures/candle-flame/ /tmp/single.gif 480 --single

# Parallel (default)
cargo run --example encode_test --features cli -- test/fixtures/candle-flame/ /tmp/parallel.gif 480
```

Print timing breakdown:
- Total encode time
- Lanczos3 time
- Quantize time
- Sub-frame time
- LZW time
- Thread count

Compare file sizes between single-threaded and parallel output — they will differ slightly (approximate canvas vs true canvas) but must be within ±1%.

## Expected performance profile

For 60 frames at 1080p→480p:
```
                    Sequential    Parallel (16 cores)
Lanczos3 downscale: ~1,100ms     ~80ms    (14× speedup)
Quantize + remap:   ~1,700ms     ~120ms   (14× speedup)
Sub-frame pass:     ~50ms        ~50ms    (sequential)
LZW encode:         ~100ms       ~10ms    (10× speedup)
GIF assembly:       ~5ms         ~5ms     (sequential)
────────────────────────────────────────────
Total:              ~2,960ms     ~265ms
```

For 333 frames the numbers scale linearly: ~16s sequential → ~1.5s parallel. The sequential sub-frame pass is negligible.

## What NOT to do

- Don't implement the CLI (clap, ffmpeg) — that's Phase 5.
- Don't set up WASM exports — that's Phase 6.
- Don't modify existing TypeScript code.
- Don't modify `packages/imagequant-gif-wasm/`.
- Don't try to parallelize the sub-frame pass — canvas dependency makes this sequential.
- Don't try to parallelize probe or denoise — they're fast enough sequential.

## Files to modify

```
packages/gifhero-core/src/
├── lib.rs           ← add encode_parallel(), parallelize internal stages
└── Cargo.toml       ← ensure rayon is in cli feature deps (should already be)

packages/gifhero-core/examples/
└── encode_test.rs   ← add --single flag, timing breakdown
```

## Reference files to read

1. `RUST-PORT-PLAN.md` — parallelization strategy section
2. `packages/gifhero-core/src/lib.rs` — the sequential encode() from Phase 3 (duplicate and modify)
3. `src/index.ts` lines 1130-1195 — the TS encodeParallel() for reference on the approximate canvas strategy
