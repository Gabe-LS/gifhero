# Rust Port — Phase 3 Prompt

Copy this entire message into a new Claude Code chat in the gifhero project directory.

---

## Rules

1. **Before writing any code**: `git checkout rust-port-phase2 && git checkout -b rust-port-phase3`
2. **Do not ask me questions.** Make reasonable decisions and keep going.
3. **Commit after each step** with a descriptive message.
4. When done, write a validation report to `packages/gifhero-core/PHASE3-REPORT.md`. Run a full encode through both the TS pipeline and the Rust pipeline for at least 2 test fixtures. Compare: GIF file sizes (must be within ±1%), frame count, and visual spot-check (write both GIFs to files so we can inspect). Flag any differences.

## Context

gifhero is a TypeScript GIF encoding library being ported to Rust. The full plan is in `RUST-PORT-PLAN.md` — read it before starting.

**Phase 1** (done): `probe.rs` and `denoise.rs` — exact match validated.
**Phase 2** (done): `lzw.rs` and `gif.rs` — byte-identical validated.
**Phase 3** (this phase): sub-frame optimization, quantization wrapper, dithering, and the full encode pipeline orchestrator. After this phase, the Rust crate can produce complete GIF files from raw RGBA frames.

The existing `packages/imagequant-gif-wasm/src/lib.rs` has the quantization functions (`quantize_simple`, `quantize_with_background`, `build_shared_palette`, `remap_with_palette`, `downsample_lanczos3`). **Do not duplicate imagequant logic.** The gifhero-core crate should depend on the `imagequant` crate directly and implement the same wrapping pattern.

## What to do

### Step 1: Implement quantize.rs — imagequant wrapper

Wrap the `imagequant` crate with the same API the pipeline needs. Read `packages/imagequant-gif-wasm/src/lib.rs` for reference — it shows exactly how to use imagequant's Rust API (`Attributes`, `Image`, `set_background`, `set_importance_map`, `Histogram`).

```rust
pub struct QuantResult {
    pub palette: Vec<u8>,          // flat RGBA, 4 bytes per entry
    pub indexed: Vec<u8>,          // palette indices
    pub palette_count: usize,
    pub transparent_index: i32,    // -1 if none
}

/// Frame 0 / keyframe quantization (no background).
pub fn quantize_simple(
    rgba: &[u8], width: usize, height: usize,
    quality_min: u8, quality_max: u8, speed: i32, max_colors: u32,
) -> QuantResult

/// Frames 1+: background-aware quantization.
/// The quantizer sees the canvas as background, producing transparent pixels
/// where the frame matches the canvas.
pub fn quantize_with_background(
    rgba: &[u8], width: usize, height: usize,
    background: &[u8], importance_map: &[u8],
    quality_min: u8, quality_max: u8, speed: i32, max_colors: u32,
) -> QuantResult

/// Build a shared palette from multiple sampled frames via Histogram.
pub fn build_shared_palette(
    frames: &[&[u8]], width: usize, height: usize,
    quality_min: u8, quality_max: u8, speed: i32, max_colors: u32,
) -> Vec<u8>  // flat RGBA palette

/// Remap a frame using a pre-built shared palette with background awareness.
pub fn remap_with_palette(
    rgba: &[u8], width: usize, height: usize,
    palette: &[u8], background: &[u8], dither: f32,
) -> QuantResult
```

For all functions: `quality_min` is always 0 in practice. The pipeline passes `(0, quality_max)` to imagequant. Dithering level is 1.0 for all calls except `remap_with_palette` which takes it as a parameter.

### Step 2: Implement subframe.rs — sub-frame optimization

Port the functions from `src/optimize/subframe.ts`. Read the plan's "Sub-frame Algorithm Detail" section AND the actual TypeScript source for edge cases.

```rust
pub struct BBox {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

/// Find bounding box of non-transparent pixels.
pub fn find_changed_bbox(
    indexed: &[u8], width: usize, height: usize,
    transparent_index: i32,
) -> Option<BBox>

/// Crop indexed data to bounding box.
pub fn crop_indexed(
    indexed: &[u8], width: usize,
    bbox: &BBox,
) -> Vec<u8>

/// Decode a full-frame indexed image onto the canvas (for frame 0 / keyframes).
pub fn decode_frame_to_canvas(
    canvas: &mut [u8],  // RGBA, width*height*4
    indexed: &[u8],
    palette: &[u8],     // RGBA, 4 bytes per entry
    width: usize,
    height: usize,
)

/// Composite a cropped sub-frame's opaque pixels onto the canvas.
pub fn composite_onto_canvas(
    canvas: &mut [u8],
    indexed: &[u8],
    palette: &[u8],     // RGBA, 4 bytes per entry
    transparent_index: i32,
    offset_x: usize,
    offset_y: usize,
    crop_w: usize,
    crop_h: usize,
    frame_w: usize,
)

pub struct TrimResult {
    pub palette: Vec<u8>,       // compacted RGBA palette
    pub indexed: Vec<u8>,       // remapped indices
    pub palette_count: usize,
    pub transparent_index: i32,
}

/// Trim unused palette entries and target power-of-2 boundaries.
pub fn trim_palette(
    palette: &[u8],       // RGB palette (3 bytes per entry, NOT RGBA)
    indexed: &[u8],
    transparent_index: i32,
) -> TrimResult
```

**Critical detail about `trim_palette`**: The input palette in the pipeline is **RGB** (3 bytes per entry) at the point where trimPalette is called — the pipeline converts RGBA→RGB via `rgbaToRgbPalette` before calling trim. The output palette is also RGB. The plan's pseudocode shows RGBA but the actual TS code uses RGB at this stage. Read `src/index.ts` lines 576, 644, 675-683 to see this flow.

**Power-of-2 targeting**: when evicting unused entries would cross a boundary (e.g., from 200 entries to 120, crossing 128), evict extra entries to actually reach the boundary (128). This reduces LZW `minCodeSize` by 1 bit, saving significant bytes. The boundaries to check are [128, 64, 32, 16, 8, 4].

### Step 3: Implement dither.rs — Floyd-Steinberg (optional for this phase)

This is only used in the fallback path (when WASM imagequant is unavailable). The primary path uses imagequant's built-in dithering. **If this makes the phase too large, skip it and add a TODO.** The primary encode path doesn't need it.

If implementing:
```rust
pub fn floyd_steinberg(
    rgba: &[u8], width: usize, height: usize,
    palette: &[u8],  // flat RGB, 3 bytes per entry
    palette_count: usize,
    serpentine: bool,
) -> Vec<u8>  // indexed output

pub fn map_nearest(
    rgba: &[u8], width: usize, height: usize,
    palette: &[u8],
    palette_count: usize,
) -> Vec<u8>
```

### Step 4: Implement the full encode pipeline in lib.rs

This is the main orchestrator. Port `encodeSubframePipeline` from `src/index.ts` lines 438-800.

```rust
pub enum Preset {
    Quality,
    Balanced,
}

pub struct EncodeOptions {
    pub width: usize,
    pub height: usize,
    pub preset: Preset,
    pub target_width: Option<usize>,
    pub target_height: Option<usize>,
    pub lossy_lzw: Option<u8>,        // override adaptive
    pub max_colors: Option<u16>,       // override adaptive
    pub stale_threshold: Option<u8>,   // override adaptive
}

pub struct EncodeFrame {
    pub data: Vec<u8>,   // RGBA
    pub delay: u16,      // milliseconds
}

/// Encode RGBA frames to a complete GIF file.
pub fn encode(frames: &[EncodeFrame], opts: &EncodeOptions) -> Vec<u8>
```

The pipeline steps (all from the actual TS code — follow it precisely):

#### 4a. Downscale (if target_width set)
Use `downsample_lanczos3` from `lanczos3.rs`. **Copy the Lanczos3 implementation from `packages/imagequant-gif-wasm/src/lib.rs`** into `packages/gifhero-core/src/lanczos3.rs` — don't add a crate dependency on imagequant-gif-wasm.

#### 4b. Temporal denoise (balanced only, >= 3 frames)
Detection gate (from `src/index.ts` lines 347-389):
- Sample every 6th frame pair (`step = max(1, floor(frames.len() / 6))`)
- For sampled pairs: count `sub_perceptual` (max channel delta 1-2) and `changed` (delta > 5)
- Trigger if: `sub_perceptual / total > 0.05 AND changed / total > 0.02`
- If triggered: call `denoise_frames(frames, width, height, 3)`

#### 4c. Probe
Call `probe_frames`. **Important**: the Rust ProbeResult must include `per_frame_motion: Vec<f64>` (motion fraction per frame) and `scene_changes: Vec<usize>` (which frames are keyframes). Verify these fields exist from Phase 1 — if they're named differently (`keyframes`), rename them to match the TS field names. The pipeline uses `probe.scene_changes` (not `keyframes`) and `probe.per_frame_motion[i]`.

#### 4d. Content-adaptive parameters

**staleThreshold** — the ACTUAL formula from `src/index.ts` lines 541-560 (NOT the simplified version in the plan):
```
complexity = motionLevel * colorComplexity
motionAdjust = motionLevel > 0.2 ? -round(min(3, (motionLevel - 0.2) * 5)) : 0

if quality:
    autoThreshold = clamp(2, 10, round(4 + 6 * min(1.0, complexity / 5000.0)) + motionAdjust)
else (balanced):
    autoThreshold = clamp(2, 10, round(5 + 5 * min(1.0, complexity / 5000.0)) + motionAdjust)

// Use auto unless user explicitly overrode
staleThreshold = if user_override { user_value } else { autoThreshold }
```

**adaptiveLzw**:
```
base = 4  (both presets)
adaptive_lzw = clamp(base, 5, round(base + colorComplexity / 3000))
```

**adaptiveMaxColors**:
```
quality:  224 if colorComplexity >= 30000, else 256
balanced: 192 if colorComplexity >= 20000, else 256
```

#### 4e. Shared palette
Build when: `target_width is set (downscaling) OR colorComplexity >= 8000`

Sample up to 10 evenly-spaced frames (`step = max(1, floor(frames.len() / 10))`).
Call `build_shared_palette(sampled, width, height, 0, quality, 1, max_colors - 1)`.
Note: pass `max_colors - 1` to leave room for a transparent entry.

#### 4f. Importance map
```
For each pixel j:
    importance_map[j] = if static_mask[j] { 0 } else { 255 }
```

#### 4g. Frame encoding loop

**Frame 0 / scene changes** (from `src/index.ts` lines 567-598):
1. `quantize_simple(frame, w, h, 0, quality, speed, max_colors)`
2. Convert RGBA palette → RGB palette: `rgbaToRgb(palette)` — take first 3 of every 4 bytes
3. `trim_palette(rgb_palette, indexed)` — no transparent index for frame 0
4. Build GifFrame: full width/height, no offset, disposal=0
5. `decode_frame_to_canvas(canvas, indexed, palette_rgba, w, h)` — use the RGBA palette (not RGB) for canvas decode

**Frames 1+** (from `src/index.ts` lines 605-707):

1. Clone frame RGBA as `input_rgba`

2. Zero alpha on static pixels:
   ```
   for j in 0..num_pixels:
       if static_mask[j]: input_rgba[j*4+3] = 0
   ```

3. Per-frame adaptive threshold:
   ```
   fm = per_frame_motion[i]  (fallback to motion_level if missing)
   frame_threshold = if !is_quality && fm < 0.02 { min(10, stale_threshold + 1) } else { stale_threshold }
   ```

4. Zero alpha on stale pixels:
   ```
   for j in 0..num_pixels:
       if input_rgba[j*4+3] == 0: continue  // already transparent
       d = max(|input[j*4] - canvas[j*4]|, |input[j*4+1] - canvas[j*4+1]|, |input[j*4+2] - canvas[j*4+2]|)
       if d <= frame_threshold: input_rgba[j*4+3] = 0
   ```

5. Quantize:
   ```
   if shared_palette:
       result = remap_with_palette(input_rgba, w, h, shared_palette, canvas, 1.0)
   else:
       result = quantize_with_background(input_rgba, w, h, canvas, importance_map, 0, quality, speed, max_colors)
   ```

6. Find bounding box of non-transparent pixels (transparent_index from quantize result)

7. If no changed pixels: emit 1×1 transparent frame using previous frame's palette

8. Crop indexed to bbox

9. Convert RGBA palette → RGB, then `trim_palette(rgb_palette, cropped, transparent_index)`

10. Build GifFrame with bbox offset, cropped dimensions

11. Update canvas — composite opaque pixels from the FULL-SIZE indexed output (not cropped):
    ```
    for j in 0..num_pixels:
        if indexed[j] != transparent_index:
            canvas[j*4..j*4+3] = palette_rgba[indexed[j]*4..indexed[j]*4+3]
            canvas[j*4+3] = 255
    ```

#### 4h. LZW encode + GIF assembly

After all frames are processed:
```
for each gif_frame:
    min_code_size = max(2, log2(pad_to_pow2(palette_count)))
    if adaptive_lzw > 0:
        lzw_data = lzw_encode_lossy(indexed, min_code_size, palette_rgb, palette_count, adaptive_lzw)
    else:
        lzw_data = lzw_encode(indexed, min_code_size)
```

Then `write_gif(width, height, frames, lzw_data_vec)`.

### Step 5: Write a test binary for validation

Create a small binary `packages/gifhero-core/examples/encode_test.rs` that:
1. Reads PNG frames from a directory (use the `png` crate, add as dev-dependency)
2. Calls `encode()` with balanced preset
3. Writes the output GIF to a file
4. Prints: frame count, file size, encode time

Usage: `cargo run --example encode_test --features cli -- test/fixtures/candle-flame/ output.gif 480`

Also create `test/rust-port/verify-encode.ts` that:
1. Loads the same fixture frames
2. Runs the TS `encode()` with balanced preset, targetWidth=480
3. Writes the output GIF to a file
4. Prints: frame count, file size, encode time

Compare the two GIFs: file size should be within ±1%.

### Step 6: Verify

```bash
cd packages/gifhero-core
cargo build --release --features cli
cargo test

# Cross-validate
cargo run --example encode_test --features cli -- ../../test/fixtures/candle-flame/ /tmp/rust-output.gif 480
npx tsx ../../test/rust-port/verify-encode.ts
# Compare file sizes
```

## What NOT to do

- Don't implement Rayon parallelism yet — that's Phase 4.
- Don't implement the CLI (clap) — that's Phase 5.
- Don't set up WASM exports — that's Phase 6.
- Don't modify existing TypeScript code (except adding verify scripts in `test/rust-port/`).
- Don't modify `packages/imagequant-gif-wasm/`.
- Don't implement the legacy/fallback encode path (NeuQuant, old imagequant npm package). Only implement the primary background-aware path using the imagequant crate directly.

## Files to create/modify

```
packages/gifhero-core/src/
├── lib.rs           ← add encode() orchestrator, EncodeOptions, Preset
├── quantize.rs      ← imagequant wrapper (quantize_simple, _with_background, build_shared_palette, remap_with_palette)
├── subframe.rs      ← find_changed_bbox, crop_indexed, decode_frame_to_canvas, composite_onto_canvas, trim_palette
├── lanczos3.rs      ← copy from imagequant-gif-wasm (downsample_lanczos3, precomputed kernels)
└── dither.rs        ← floyd_steinberg + map_nearest (or TODO stub)

packages/gifhero-core/
├── Cargo.toml       ← add `png` as dev-dependency for the test example
└── examples/
    └── encode_test.rs

test/rust-port/
└── verify-encode.ts
```

## Reference files to read (in order)

1. `RUST-PORT-PLAN.md` — algorithm specs
2. `src/index.ts` lines 438-800 — the actual TS pipeline (THIS IS THE SOURCE OF TRUTH, not the plan)
3. `src/optimize/subframe.ts` — sub-frame functions
4. `packages/imagequant-gif-wasm/src/lib.rs` — how to use imagequant Rust API
5. `packages/gifhero-core/src/probe.rs` — Phase 1 output (check field names match)
6. `packages/gifhero-core/src/lzw.rs` — Phase 2 output
7. `packages/gifhero-core/src/gif.rs` — Phase 2 output

## Critical warning

The plan's algorithm descriptions are simplified. The actual TypeScript code in `src/index.ts` is the source of truth. Where the plan and the code disagree, **follow the code**. Key differences:

1. **staleThreshold**: uses `motionLevel * colorComplexity` as a complexity product, not just base + motionFloor. Formula is in step 4d above.
2. **ProbeResult fields**: TS uses `sceneChanges` (not `keyframes`) and `perFrameMotion`. Make sure Phase 1's Rust struct matches — rename if needed.
3. **Palette format**: pipeline converts RGBA→RGB before `trimPalette`. Canvas uses RGBA. GIF writer receives RGB. Don't mix them up.
4. **Shared palette sampling**: TS samples every `floor(frames.length / 10)`th frame (up to ~10 frames), not every 8th.
5. **Shared palette maxColors**: passes `max_colors - 1` to `build_shared_palette`, not `max_colors`.
6. **Per-frame threshold boost**: `staleThreshold + 1` when `per_frame_motion[i] < 0.02` AND preset is balanced.
