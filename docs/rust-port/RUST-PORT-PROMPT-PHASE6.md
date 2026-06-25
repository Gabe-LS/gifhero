# Rust Port — Phase 6 Prompt

Copy this entire message into a new Claude Code chat in the gifhero project directory.

---

## Rules

1. **Before writing any code**: `git checkout rust-port-phase5 && git checkout -b rust-port-phase6`
2. **Do not ask me questions.** Make reasonable decisions and keep going.
3. **Commit after each step** with a descriptive message.
4. When done, write a validation report to `packages/gifhero-core/PHASE6-REPORT.md`. Build the WASM module, run the browser benchmark (server at `test/browser/gifski-server.ts`), and compare the new WASM-powered output against the old TS pipeline output. Report: file sizes, encode times, and whether the browser SDK works end-to-end with the new WASM backend.

## Context

gifhero is a TypeScript GIF encoding library. We've ported the entire encoding pipeline to Rust across Phases 1-5:

- **Phase 1**: probe + denoise (exact match)
- **Phase 2**: LZW + GIF writer (byte-identical)
- **Phase 3**: sub-frame + quantize + full pipeline (within 0.02%)
- **Phase 4**: Rayon parallel + imagequant threads (2.3× speedup)
- **Phase 5**: CLI with ffmpeg (working, 1.0s for 100 frames at 480p)

**Phase 6** (this phase): compile the Rust pipeline to WASM and wire it into the browser SDK, replacing the TypeScript encode pipeline. The browser SDK API stays unchanged — `gifhero.fromFile(file).fps(20).width(480).toGif()` still works, but now calls a single WASM `encode()` function instead of orchestrating probe → quantize → subframe → LZW in JavaScript.

## Architecture

Currently the browser pipeline is:

```
video-worker.ts:
  demux (mediabunny) → decode (VideoDecoder) → extract frames
  → TS encode() [probe → quantize(WASM) → subframe(JS) → LZW(JS) → GIF(JS)]
  → return GIF
```

After this phase:

```
video-worker.ts:
  demux (mediabunny) → decode (VideoDecoder) → extract frames
  → WASM encode() [entire pipeline in Rust: probe → quantize → subframe → LZW → GIF]
  → return GIF
```

The decode stays in JS (VideoDecoder is a browser API). Only the encode pipeline moves to WASM.

## What to do

### Step 1: Implement wasm.rs — WASM exports

Create the wasm-bindgen exports in `packages/gifhero-core/src/wasm.rs`. This module is only compiled when the `wasm` feature is enabled.

```rust
#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Encode RGBA frames to a complete GIF file.
///
/// frames_rgba: all frames concatenated (frame_count × width × height × 4 bytes)
/// frame_count: number of frames
/// width, height: frame dimensions
/// delay_ms: per-frame delay in milliseconds
/// target_width: target width for Lanczos3 downscale (0 = no resize)
/// preset: 0 = balanced, 1 = quality
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn encode_gif(
    frames_rgba: &[u8],
    frame_count: u32,
    width: u32,
    height: u32,
    delay_ms: u32,
    target_width: u32,
    preset: u8,
) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let fc = frame_count as usize;
    let frame_size = w * h * 4;

    let frames: Vec<EncodeFrame> = (0..fc)
        .map(|i| {
            let start = i * frame_size;
            EncodeFrame {
                data: frames_rgba[start..start + frame_size].to_vec(),
                delay: delay_ms as u16,
            }
        })
        .collect();

    let opts = EncodeOptions {
        width: w,
        height: h,
        preset: if preset == 1 { Preset::Quality } else { Preset::Balanced },
        target_width: if target_width > 0 { Some(target_width as usize) } else { None },
        target_height: None,
        lossy_lzw: None,
        max_colors: None,
        stale_threshold: None,
    };

    // Use single-threaded encode (no Rayon in WASM)
    crate::encode(&frames, &opts)
}
```

**Important**: the WASM build must NOT include Rayon (it's behind the `cli` feature). The `encode()` function (not `encode_parallel()`) is used in WASM. imagequant's `threads` feature also must be disabled for WASM — change the Cargo.toml so `threads` is only enabled for the `cli` feature:

```toml
[dependencies]
imagequant = { version = "4", default-features = false }

[features]
cli = ["clap", "rayon", "imagequant/threads"]
wasm = ["wasm-bindgen"]
```

### Step 2: Update Cargo.toml for WASM builds

Make sure the crate builds for WASM. Key changes:

- `imagequant/threads` must be in the `cli` feature, NOT in the base dependency (threads/rayon panic in WASM)
- The `wasm` feature enables only `wasm-bindgen`
- The `[[bin]]` section needs `required-features = ["cli"]` so it's excluded from WASM builds

Verify the WASM feature compiles:
```bash
# Check that it compiles for WASM target (don't need to run wasm-pack yet)
cargo check --target wasm32-unknown-unknown --features wasm --no-default-features
```

### Step 3: Build the WASM module with wasm-pack

```bash
cd packages/gifhero-core

RUSTFLAGS="-C target-feature=+bulk-memory,+nontrapping-fptoint" \
  wasm-pack build --target web --features wasm --no-default-features --no-opt \
  --out-dir ../../src/wasm/gifhero-core
```

This produces:
- `src/wasm/gifhero-core/gifhero_core_bg.wasm` — the WASM binary
- `src/wasm/gifhero-core/gifhero_core.js` — wasm-bindgen JS glue
- `src/wasm/gifhero-core/gifhero_core.d.ts` — TypeScript types

### Step 4: Create the ESM glue module

Create `src/wasm/gifhero-core/gifhero-core-wasm.ts` — same pattern as the existing `src/wasm/imagequant-gif/imagequant-gif-wasm.ts`:

1. Import the WASM binary as base64 (for universal loading in browsers, workers, extensions)
2. Synchronous initialization via `WebAssembly.Module` + `WebAssembly.Instance`
3. Export a typed `encode_gif()` function

To generate the base64 file:
```bash
node -e "
const fs = require('fs');
const wasm = fs.readFileSync('src/wasm/gifhero-core/gifhero_core_bg.wasm');
const b64 = wasm.toString('base64');
fs.writeFileSync('src/wasm/gifhero-core/gifhero_core_bg.b64.js',
  'export const wasmBase64 = \"' + b64 + '\";\n');
console.log('WASM:', (wasm.length/1024).toFixed(0), 'KB');
console.log('Base64:', (b64.length/1024).toFixed(0), 'KB');
"
```

The ESM glue module should follow the same pattern as `src/wasm/imagequant-gif/imagequant-gif-wasm.ts`:
- Read the generated `gifhero_core.js` from wasm-pack to understand the import structure
- Implement the heap management, string/array passing functions
- Export `encode_gif()` with proper Uint8Array in/out handling
- Use `ensureWasm()` lazy initialization

Look at the existing glue module (`src/wasm/imagequant-gif/imagequant-gif-wasm.ts`) carefully — it's 233 lines and handles all the wasm-bindgen interop. The new one will be much simpler since there's only one exported function (`encode_gif`).

### Step 5: Create a TypeScript wrapper

Create `src/encode-wasm.ts` that provides a clean API over the raw WASM call:

```typescript
import { encode_gif } from "./wasm/gifhero-core/gifhero-core-wasm.js";

export function encodeWasm(
  frames: Array<{ data: Uint8ClampedArray; delay: number }>,
  width: number,
  height: number,
  options: {
    preset?: "quality" | "balanced";
    targetWidth?: number;
  } = {},
): Uint8Array {
  const frameSize = width * height * 4;
  const buffer = new Uint8Array(frameSize * frames.length);
  for (let i = 0; i < frames.length; i++) {
    buffer.set(frames[i].data, i * frameSize);
  }

  const delay = frames[0]?.delay ?? 50;
  const preset = options.preset === "quality" ? 1 : 0;
  const targetWidth = options.targetWidth ?? 0;

  return encode_gif(buffer, frames.length, width, height, delay, targetWidth, preset);
}
```

### Step 6: Wire into the video worker

Update `src/browser/worker/video-worker.ts` to use the new WASM encode instead of the TS pipeline:

Replace:
```typescript
import { encode, IncrementalProbe } from "../../index.js";
```

With:
```typescript
import { encodeWasm } from "../../encode-wasm.js";
```

And replace the `encode()` call (around line 150) with:
```typescript
const gif = encodeWasm(frames, extractW, extractH, {
  preset,
  targetWidth: finalTargetWidth && finalTargetWidth < extractW ? finalTargetWidth : undefined,
});
```

The `IncrementalProbe` is no longer needed in the worker — probing now happens inside the WASM encode call.

**Important**: The video worker still does demux + decode in JS (VideoDecoder/Mediabunny). Only the encode step changes. The frame extraction, FPS sampling, and ImageBitmap storage stay the same.

### Step 7: Update tsup build config

Make sure the new WASM base64 file and glue module are included in the browser builds. The `video-worker` tsup entry must bundle the new `encode-wasm.ts` + glue module.

Check `tsup.config.ts` — the video-worker entry uses `noExternal: [/.*/]` which should automatically include the new module. Verify the built `dist/video-worker.js` contains the base64 WASM.

### Step 8: Build and test in browser

```bash
# Build the TypeScript bundles
npm run build

# Start the test server (if not running)
npx tsx test/browser/gifski-server.ts

# Open http://localhost:3333/test/browser/
# Run the benchmark with a video file
```

Compare the output against the old TS pipeline:
- File sizes should be within ±2% (minor differences from Rust vs JS floating-point)
- Encode times should be faster (all pipeline stages in WASM instead of JS)
- Visual quality should be identical

### Step 9: Keep the old pipeline working

**Do not remove the old TS pipeline code.** The `src/index.ts` `encode()` function and all its dependencies must continue to work. The WASM encode is an alternative path, not a replacement (yet). Both paths should coexist:

- `encode()` from `src/index.ts` — the TS pipeline (existing, still default for Node.js)
- `encodeWasm()` from `src/encode-wasm.ts` — the Rust WASM pipeline (used by browser video worker)

The browser SDK uses the WASM path. Node.js consumers still use the TS path. A future PR can switch Node.js over too.

## What NOT to do

- Don't remove or modify the existing TS encode pipeline (`src/index.ts`).
- Don't modify the existing `packages/imagequant-gif-wasm/` crate — it stays as-is for backward compatibility.
- Don't try to add Rayon/threads to the WASM build — it will crash (SharedArrayBuffer + wasm-bindgen-rayon is broken, as we discovered with gifski-wasm).
- Don't modify the browser SDK API (`gifhero.fromFile()`, etc.) — only the internal implementation changes.
- Don't modify the CLI (`main.rs`) — it's done.

## Files to create/modify

```
Create:
  packages/gifhero-core/src/wasm.rs              ← wasm-bindgen encode_gif() export
  src/wasm/gifhero-core/gifhero-core-wasm.ts     ← ESM glue (base64 WASM, lazy init)
  src/wasm/gifhero-core/gifhero_core_bg.b64.js   ← base64-encoded WASM binary
  src/encode-wasm.ts                              ← clean TS wrapper over raw WASM

Modify:
  packages/gifhero-core/Cargo.toml                ← move imagequant/threads to cli feature
  packages/gifhero-core/src/lib.rs                ← pub mod wasm (behind #[cfg])
  src/browser/worker/video-worker.ts              ← use encodeWasm instead of TS encode
  tsup.config.ts                                  ← verify video-worker bundles new modules

Generated (by wasm-pack, don't hand-edit):
  src/wasm/gifhero-core/gifhero_core_bg.wasm
  src/wasm/gifhero-core/gifhero_core.js
  src/wasm/gifhero-core/gifhero_core.d.ts
```

## Reference files to read (in order)

1. `src/wasm/imagequant-gif/imagequant-gif-wasm.ts` — existing ESM glue pattern (COPY THIS PATTERN)
2. `src/browser/worker/video-worker.ts` — where to wire in the new WASM encode
3. `packages/gifhero-core/src/lib.rs` — encode() function signature
4. `tsup.config.ts` — build config for browser bundles
5. `RUST-PORT-PLAN.md` — WASM exports section
6. `CLAUDE.md` — build commands for wasm-pack

## WASM build command reference

```bash
cd packages/gifhero-core

# Build WASM (no Rayon, no imagequant threads)
RUSTFLAGS="-C target-feature=+bulk-memory,+nontrapping-fptoint" \
  wasm-pack build --target web --features wasm --no-default-features --no-opt \
  --out-dir ../../src/wasm/gifhero-core

# Generate base64
node -e "
const fs = require('fs');
const wasm = fs.readFileSync('../../src/wasm/gifhero-core/gifhero_core_bg.wasm');
const b64 = wasm.toString('base64');
fs.writeFileSync('../../src/wasm/gifhero-core/gifhero_core_bg.b64.js',
  'export const wasmBase64 = \"' + b64 + '\";\n');
console.log('WASM:', (wasm.length/1024).toFixed(0), 'KB, base64:', (b64.length/1024).toFixed(0), 'KB');
"

# Build TS bundles
cd ../..
npm run build
```
