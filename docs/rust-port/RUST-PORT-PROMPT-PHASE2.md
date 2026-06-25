# Rust Port — Phase 2 Prompt

Copy this entire message into a new Claude Code chat in the gifhero project directory.

---

## Rules

1. **Before writing any code**, switch to the phase 1 branch and create a new branch from it: `git checkout rust-port-phase1 && git checkout -b rust-port-phase2`
2. **Do not ask me questions.** Make reasonable decisions and keep going.
3. **Commit after each step** with a descriptive message.
4. When done, write a validation report to `packages/gifhero-core/PHASE2-REPORT.md` comparing the Rust GIF output against the TypeScript GIF output for at least 2 test cases. Include: byte-identical (yes/no), file size comparison, and if not identical, describe where the first difference occurs (header, palette, LZW data, etc.). Flag any mismatches.

## Context

gifhero is a TypeScript GIF encoding library being ported to Rust. The full plan with every algorithm in pseudocode is in `RUST-PORT-PLAN.md` — read it completely before starting.

Phase 1 is done: `packages/gifhero-core/` exists with `probe.rs` and `denoise.rs` fully implemented and validated (exact match against TypeScript). The crate builds and tests pass on branch `rust-port-phase1`.

## What to do

**Phase 2: Implement LZW encoder, lossy LZW encoder, and GIF89a binary writer.**

### Step 1: Implement lzw.rs — Standard LZW encoder

Port from `src/encoder/lzw.ts`. The algorithm is specified exactly in `RUST-PORT-PLAN.md` under "LZW Algorithm Detail".

```rust
pub fn lzw_encode(indexed: &[u8], min_code_size: u8) -> Vec<u8>
```

Key details:
- Variable-width codes, 9-12 bits, LSB-first packing
- `clear_code = 1 << min_code_size`
- `eoi_code = clear_code + 1`
- Initial `code_size = min_code_size + 1`
- Dictionary: `HashMap<(u16, u8), u16>` mapping (prefix_code, suffix_byte) → new_code
- Code size bumps when `next_code >= (1 << code_size)`
- Max dictionary size: 4096 entries (12-bit codes)
- **Deferred clear code strategy**: when dictionary fills (next_code reaches 4096), don't clear immediately. Track bits emitted over a window. Clear only when compression ratio degrades past 11 bits/pixel over 100 pixels. This is critical for file size.

Bit packing: accumulate bits in a u32 buffer, flush whole bytes to output. LSB-first means the first code's lowest bit goes into the lowest bit of the first output byte.

### Step 2: Implement lossy-lzw.rs (or add to lzw.rs) — Lossy LZW encoder

Port from `src/encoder/lossy-lzw.ts`. The algorithm is specified in `RUST-PORT-PLAN.md` under "Lossy LZW Algorithm Detail".

```rust
pub fn lzw_encode_lossy(
    indexed: &[u8],
    min_code_size: u8,
    palette: &[u8],      // flat RGBA, 4 bytes per color
    palette_count: usize,
    lossiness: u8,        // Chebyshev distance threshold (typically 4-5)
) -> Vec<u8>
```

Key details:
- Build a 256×256 Chebyshev distance table from palette RGB values (ignore alpha): `dist[i][j] = max(|Ri-Rj|, |Gi-Gj|, |Bi-Bj|)`
- Same LZW structure as standard, but with approximate dictionary matching:
  - When looking up (prefix, suffix): first try exact match
  - If no exact match: try all palette entries `alt` where `dist[suffix][alt] <= lossiness`, check if (prefix, alt) exists in dictionary
  - Accept the first match found (longest chain wins)
- Deferred clear strategy is identical to standard LZW

### Step 3: Implement gif.rs — GIF89a binary writer

Port from `src/encoder/gif-writer.ts`. The algorithm is specified in `RUST-PORT-PLAN.md` under "GIF Writer Detail".

```rust
pub struct GifFrame {
    pub indexed: Vec<u8>,           // palette indices
    pub palette: Vec<u8>,           // flat RGBA, 4 bytes per entry
    pub palette_count: usize,
    pub transparent_index: i32,     // -1 = none
    pub delay: u16,                 // milliseconds
    pub x: u16,                     // bbox offset
    pub y: u16,
    pub width: u16,                 // bbox dimensions
    pub height: u16,
    pub disposal: u8,               // 0=none, 1=keep, 2=restore bg
}

pub fn write_gif(
    width: u16,
    height: u16,
    frames: &[GifFrame],
    lzw_data: &[Vec<u8>],          // pre-encoded LZW data per frame
) -> Vec<u8>
```

Key details:
- Header: `GIF89a` (6 bytes)
- Logical Screen Descriptor: width(u16 LE), height(u16 LE), packed byte (no GCT → 0x00), bg color index (0), pixel aspect ratio (0)
- Netscape Application Extension for looping: `0x21 0xFF 0x0B "NETSCAPE2.0" 0x03 0x01 0x00 0x00 0x00`
- Per frame:
  - Graphic Control Extension: `0x21 0xF9 0x04`, packed byte `(disposal << 2) | (has_transparency ? 1 : 0)`, delay in centiseconds (u16 LE, `delay_ms / 10` rounded), transparent index, `0x00` terminator
  - Image Descriptor: `0x2C`, x(u16 LE), y(u16 LE), w(u16 LE), h(u16 LE), packed byte `0x80 | color_table_bits` (LCT flag + size)
  - Local Color Table: RGB entries (3 bytes each, NOT RGBA — strip alpha), padded to next power-of-2 count (min 4). Padding entries are `0x00 0x00 0x00`.
  - LZW minimum code size: `max(2, log2(padded_palette_size))` — 1 byte
  - Image data: LZW bytes written in sub-blocks (each block: 1 length byte + up to 255 data bytes), terminated by `0x00`
- Trailer: `0x3B`

**Important**: Local Color Table entries are 3 bytes (RGB), not 4 (RGBA). The alpha channel from the palette is NOT written to the GIF. This is easy to get wrong.

Power-of-2 palette padding: `fn pad_to_pow2(n) → smallest of [4, 8, 16, 32, 64, 128, 256] that is >= n`.

The `color_table_bits` field in the Image Descriptor packed byte is `log2(padded_size) - 1`. For padded_size=4 → bits=1, padded_size=8 → bits=2, ..., padded_size=256 → bits=7.

### Step 4: Write integration test

Create `packages/gifhero-core/tests/gif_test.rs` that:

1. Creates a minimal 2-frame GIF manually:
   - Frame 1: 4x4 solid red, frame 2: 4x4 solid blue
   - Palette: [red, blue, transparent]
   - Delays: 100ms each
2. Calls `lzw_encode` on each frame's indexed data
3. Calls `write_gif` to assemble
4. Asserts the output starts with `GIF89a`
5. Asserts the output ends with `0x3B`
6. Asserts file size is reasonable (< 200 bytes for 2 tiny frames)
7. Writes the GIF to a temp file and verifies it's valid by checking the header structure

Also create a cross-validation test `test/rust-port/verify-lzw.ts` that:
1. Takes a known indexed buffer + palette (extract from one frame of a test fixture using the TS pipeline — hook into the encode pipeline and dump one frame's indexed data + palette before LZW encoding)
2. Runs the TS `lzwEncode` and `lzwEncodeLossy` on it
3. Prints the output as hex + length
4. This will be used to verify the Rust LZW output matches byte-for-byte

### Step 5: Verify

```bash
cd packages/gifhero-core
cargo build --release --features cli
cargo test
```

Both must pass. The GIF test should produce a valid file.

For the cross-validation against TypeScript LZW:
```bash
npx tsx test/rust-port/verify-lzw.ts
```

Compare the TS output against a Rust test that encodes the same input. LZW output must be byte-identical for the same input — there's only one correct encoding for a given input with the same dictionary management strategy.

## What NOT to do

- Don't port the sub-frame pipeline, dithering, or quantization — that's Phase 3.
- Don't modify any existing TypeScript code (except adding the verify script).
- Don't modify the existing `packages/imagequant-gif-wasm/` crate.
- Don't set up WASM builds — that's Phase 6.
- Don't implement the full encode pipeline — just the three modules (LZW, lossy LZW, GIF writer).

## Files to create/modify

```
packages/gifhero-core/src/
├── lzw.rs         ← lzw_encode() + lzw_encode_lossy()
└── gif.rs         ← GifFrame + write_gif()

packages/gifhero-core/tests/
└── gif_test.rs    ← integration test: encode 2-frame GIF

test/rust-port/
└── verify-lzw.ts  ← TS reference output for cross-validation
```

Update `packages/gifhero-core/src/lib.rs` to replace the stub `pub mod lzw;` and `pub mod gif;` with the real modules.

## Reference files to read

- `RUST-PORT-PLAN.md` — complete algorithm specs (LZW, Lossy LZW, GIF Writer sections)
- `src/encoder/lzw.ts` — TypeScript LZW implementation (113 LOC)
- `src/encoder/lossy-lzw.ts` — TypeScript lossy LZW implementation (196 LOC)
- `src/encoder/gif-writer.ts` — TypeScript GIF writer (263 LOC)
- `packages/gifhero-core/src/lib.rs` — current crate structure from Phase 1
