# gifhero Rust Port Plan

## Goal

Port the entire GIF encoding pipeline from TypeScript to Rust. One codebase, two targets:
- **Native CLI** with Rayon multi-threading (~3s for 333 frames at 480p)
- **WASM** for browser SDK and Node.js (~20s, replacing current TS pipeline)

The TypeScript layer becomes a thin wrapper calling into WASM. Browser SDK API (`gifhero.fromFile().fps(20).toGif()`) stays unchanged.

## Current State

### What's already in Rust (`packages/imagequant-gif-wasm/src/lib.rs`, 391 LOC)
- `quantize_with_background()` — per-frame quantize with canvas background (uses imagequant v4)
- `quantize_simple()` — frame 0 quantize (no background)
- `quantize_no_dither()` — nearest-color mapping
- `build_shared_palette()` — Histogram-based multi-frame shared palette
- `remap_with_palette()` — remap with pre-built palette + background awareness
- `downsample_lanczos3()` — two-pass separable Lanczos3 with precomputed kernel weights, f32 accumulators, non-premultiplied alpha. 12x faster than JS (18ms vs 228ms for 1080p→480p).

### What needs porting from TypeScript (~2,200 LOC → ~1,600 LOC Rust)

| Module | TS File | TS LOC | Description |
|--------|---------|--------|-------------|
| Probe | `src/probe.ts` | 264 | Static mask, motion level, color complexity, keyframe detection |
| Denoise | `src/dither/temporal.ts` (denoise part) + `src/index.ts` (denoiseFrames) | ~80 | 3-frame temporal median, noise-aware gate |
| Sub-frame | `src/optimize/subframe.ts` | 369 | findChangedBbox, buildSubframe, compositeOntoCanvas, decodeFrameToCanvas, trimPalette, palette eviction |
| Dither | `src/dither/floyd-steinberg.ts` | ~170 | Floyd-Steinberg error diffusion + mapNearest + temporal locking |
| LZW | `src/encoder/lzw.ts` | 113 | Standard GIF LZW (variable-width codes 9-12 bits, LSB-first, deferred clear) |
| Lossy LZW | `src/encoder/lossy-lzw.ts` | 196 | Chebyshev distance matching, approximate dictionary lookup |
| GIF writer | `src/encoder/gif-writer.ts` | 263 | GIF89a binary writer (headers, LCT/GCT, GCE, sub-blocking, Netscape ext) |
| Pipeline | `src/index.ts` (encodeSubframePipeline) | ~400 | Orchestrator: preset resolution, adaptive thresholds, frame loop |

## New Crate Structure

```
packages/gifhero-core/
├── Cargo.toml
└── src/
    ├── lib.rs           Public API: encode(frames, opts) → Vec<u8>
    ├── probe.rs         Pre-encode frame analysis
    ├── subframe.rs      Sub-frame optimization (bbox, transparency, canvas)
    ├── lanczos3.rs      Lanczos3 downscale (move from imagequant-gif-wasm)
    ├── lzw.rs           Standard + lossy LZW encoder
    ├── gif.rs           GIF89a binary writer
    ├── denoise.rs       Temporal median denoiser
    ├── dither.rs        Floyd-Steinberg + temporal locking
    ├── quantize.rs      Wrapper around imagequant crate
    ├── wasm.rs          wasm-bindgen exports (browser/Node)
    └── main.rs          CLI entry point
```

### Cargo.toml

```toml
[package]
name = "gifhero-core"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
imagequant = { version = "4", default-features = false }
rayon = { version = "1", optional = true }
wasm-bindgen = { version = "0.2", optional = true }
clap = { version = "4", features = ["derive"], optional = true }

[features]
default = ["cli"]
cli = ["clap", "rayon"]
wasm = ["wasm-bindgen"]

[[bin]]
name = "gifhero"
required-features = ["cli"]

[profile.release]
opt-level = 2
lto = true
strip = true
```

### Build commands

```bash
# Native CLI (Rayon, all cores)
cargo build --release --features cli

# WASM (browser SDK)
RUSTFLAGS="-C target-feature=+bulk-memory,+nontrapping-fptoint" \
  wasm-pack build --target web --features wasm --no-default-features \
  --out-dir ../../src/wasm/gifhero-core

# Run CLI
./target/release/gifhero encode input.mp4 -w 480 --fps 20 -o output.gif
```

## Algorithm Reference

Everything below must be ported exactly. Any deviation will produce different output.

### Presets

#### quality
- quantizerQuality: 98, speed: 1
- staleThreshold: base 4, motionFloor 4 (5 when motionLevel > 0.08)
- lossyLzw: 4 (adaptive: `clamp(4, 5, round(4 + colorComplexity / 3000))`)
- maxColors: 256 (224 when colorComplexity >= 30000)
- No temporal denoiser
- No per-frame threshold boost

#### balanced (default)
- quantizerQuality: 95, speed: 1
- staleThreshold: base 5, per-frame boost +1 on near-static frames
- lossyLzw: 4 (adaptive: `clamp(4, 5, round(4 + colorComplexity / 3000))`)
- maxColors: 256 (192 when colorComplexity >= 20000)
- Temporal denoiser: 3-frame median, threshold 3
- Per-frame threshold boost: +1 when frame motion < 5%

### Pipeline: `encodeSubframePipeline`

```
Input: frames (RGBA), width, height, preset, targetWidth

1. DOWNSCALE (if targetWidth set)
   - dstH = floor(height * (targetWidth / width))
   - Each frame: downsample_lanczos3(frame, width, height, targetWidth, dstH)
   - Update width/height to target dimensions
   - downscaleRatio = srcWidth / width

2. TEMPORAL DENOISE (balanced preset only, >= 3 frames)
   - Detection: sample every 6th frame pair
     - subPerceptual: pixels with max channel delta 1-2
     - changed: pixels with max channel delta > 5
   - Gate: subPerceptual/total > 0.05 AND changed/total > 0.02
   - If triggered: denoiseFrames(frames, width, height, threshold=3)
     - 3-frame median filter: for each pixel, median of frames[i-1], frames[i], frames[i+1]
     - Clamp: result must be within ±threshold of original

3. PROBE
   - probeFrames(frames, width, height, probeTolerance=3)
   - Returns: { staticMask, motionLevel, colorComplexity, keyframes }
   - Static mask: per-pixel, 1 if max-min range <= tolerance across ALL frames
   - Motion level: average fraction of pixels changing per frame (threshold > 5 per channel)
   - Color complexity: distinct 6-bit-quantized colors across sampled frames (every 5th)
   - Keyframes: frames where > 60% pixels change OR motion-to-static transition (> 15% → < 2%)

4. CONTENT-ADAPTIVE PARAMETERS
   a. staleThreshold:
      - Start with preset base (quality=4, balanced=5)
      - motionFloor: quality uses 4 (5 when motion > 0.08), balanced uses 5
      - staleThreshold = max(staleThreshold, motionFloor)
      - motionAdjust: if motionLevel > 0.2: -round(min(3, (motionLevel - 0.2) * 5))
      - staleThreshold += motionAdjust
      - Clamp to [1, 20]

   b. adaptiveLzw:
      - base = preset lossyLzw (4)
      - adaptiveLzw = clamp(base, 5, round(base + colorComplexity / 3000))

   c. adaptiveMaxColors:
      - quality: 224 when colorComplexity >= 30000, else 256
      - balanced: 192 when colorComplexity >= 20000, else 256

5. SHARED PALETTE (when downscaling OR colorComplexity >= 8000)
   - Sample up to 8 evenly-spaced frames
   - build_shared_palette(sampled_frames, width, height, quality, speed=1, maxColors)
   - Returns flat RGBA palette bytes

6. ENCODE FRAMES (sequential loop)
   For each frame i:

   a. Frame 0 / keyframe frames:
      - quantize_simple(frameRgba, w, h, quality, speed, maxColors)
      - decodeFrameToCanvas: decode indexed → canvas RGBA
      - Full-frame output (no bbox crop), disposal=none
      - Reset canvas at keyframes

   b. Frames 1+ (non-keyframe):
      i. Build importance map from static mask:
         - 0 = static pixel (low importance), 128 = normal
         - If downscaling: scale importance by downscaleRatio

      ii. Alpha zeroing (prepare input for quantizer):
         - Clone frame RGBA
         - Static mask pixels → alpha = 0
         - Pixels where max(|src - canvas|) <= staleThreshold → alpha = 0
         - Per-frame boost (balanced only): if frame motion < 5%, use staleThreshold + 1

      iii. Quantize:
         - If shared palette exists:
           remap_with_palette(inputRgba, w, h, sharedPalette, canvas, dither=1.0)
         - Else:
           quantize_with_background(inputRgba, w, h, canvas, importanceMap, quality, speed, maxColors)

      iv. Post-quantization transparency recovery:
         - For pixels where quantizer assigned opaque but source alpha was 0:
           set indexed pixel to transparentIndex (if one exists in palette)

      v. Find bounding box:
         - Scan indexed output for non-transparent pixels
         - Record minX, minY, maxX, maxY
         - If no changed pixels: emit 1x1 transparent frame

      vi. Crop indexed data to bbox

      vii. Trim palette:
         - Count which palette entries are used in cropped indexed data
         - Build remap table: old index → new index
         - If evicting entries crosses a power-of-2 boundary (256→128, 128→64, etc.):
           evict ADDITIONAL unused entries to cross the boundary
           (reduces LZW minCodeSize by 1 bit)
         - Apply remap to indexed data

      viii. Composite onto canvas:
         - For each pixel in the full frame:
           if indexed pixel is NOT transparent: decode palette color → write to canvas

7. LZW ENCODE each frame's indexed data
   - If lossyLzw > 0: use lossy LZW (Chebyshev distance matching)
   - Else: use standard LZW
   - Deferred clear code: when dictionary fills (4096 entries), don't clear immediately.
     Continue matching for a "defer window" (measured by compression ratio).
     Clear only when ratio degrades past threshold (> 11 bits/pixel over window).

8. ASSEMBLE GIF
   - GIF89a header
   - Logical Screen Descriptor (width, height, no GCT)
   - Netscape extension (loop = 0 = infinite)
   - For each frame:
     - Graphic Control Extension (delay in centiseconds, disposal=1, transparent index)
     - Image Descriptor (x, y from bbox, w, h from crop, local color table flag)
     - Local Color Table (palette, padded to power-of-2)
     - LZW minimum code size
     - Image data in sub-blocks (max 255 bytes each)
   - Trailer byte (0x3B)
```

### Probe Algorithm Detail (`probe.ts`)

```
probeFrames(frames, width, height, tolerance=3):
  numPixels = width * height
  
  // Per-pixel min/max tracking
  minR = new Uint8Array(numPixels).fill(255)
  maxR = new Uint8Array(numPixels).fill(0)
  // ... same for G, B
  
  For each frame:
    For each pixel i:
      minR[i] = min(minR[i], frame[i*4])
      maxR[i] = max(maxR[i], frame[i*4])
      // ... same for G, B
  
  // Static mask
  staticMask = new Uint8Array(numPixels)
  For each pixel i:
    range = max(maxR[i]-minR[i], maxG[i]-minG[i], maxB[i]-minB[i])
    staticMask[i] = (range <= tolerance) ? 1 : 0
  
  // Per-frame motion
  motionCounts = []
  For each frame i > 0:
    changed = 0
    For each pixel j:
      maxDelta = max(|frame[i][j*4] - frame[i-1][j*4]|,
                     |frame[i][j*4+1] - frame[i-1][j*4+1]|,
                     |frame[i][j*4+2] - frame[i-1][j*4+2]|)
      if maxDelta > 5: changed++
    motionCounts.push(changed / numPixels)
  
  motionLevel = average(motionCounts)
  
  // Color complexity (6-bit quantization)
  colorSet = new Set()
  step = max(1, floor(frames.length / 5))  // sample ~5 frames
  For sampled frames:
    For each pixel i:
      if staticMask[i]: continue
      r6 = frame[i*4] >> 2
      g6 = frame[i*4+1] >> 2
      b6 = frame[i*4+2] >> 2
      colorSet.add((r6 << 12) | (g6 << 6) | b6)
  colorComplexity = colorSet.size
  
  // Keyframes
  keyframes = [0]  // frame 0 is always a keyframe
  For each frame i > 0:
    if motionCounts[i-1] > 0.6:  // scene change
      keyframes.push(i)
    else if i >= 2 AND motionCounts[i-2] > 0.15 AND motionCounts[i-1] < 0.02:
      keyframes.push(i)  // motion-to-static transition
  
  return { staticMask, motionLevel, colorComplexity, keyframes }
```

### Sub-frame Algorithm Detail (`optimize/subframe.ts`)

```
findChangedBbox(indexed, palette, canvas, width, height, transparentIndex):
  minX=width, minY=height, maxX=-1, maxY=-1
  For each pixel (x, y):
    idx = indexed[y * width + x]
    if idx != transparentIndex:
      // This pixel changed — expand bbox
      minX = min(minX, x); minY = min(minY, y)
      maxX = max(maxX, x); maxY = max(maxY, y)
  
  if maxX < 0: return null  // no changes
  return { x: minX, y: minY, w: maxX-minX+1, h: maxY-minY+1 }

buildSubframe(indexed, palette, paletteCount, transparentIndex,
              canvas, staticMask, width, height, staleThreshold):
  // Already handled by alpha zeroing before quantization in the main pipeline.
  // This function is called in the legacy (non-WASM) path.
  // In the WASM path, transparency is handled by imagequant's set_background.
  
  // The key logic: for each pixel, decide opaque or transparent
  For each pixel i:
    if staticMask[i]: indexed[i] = transparentIndex
    else:
      srcR = source[i*4], srcG = source[i*4+1], srcB = source[i*4+2]
      canR = canvas[i*4], canG = canvas[i*4+1], canB = canvas[i*4+2]
      maxDiff = max(|srcR-canR|, |srcG-canG|, |srcB-canB|)
      if maxDiff <= staleThreshold: indexed[i] = transparentIndex

compositeOntoCanvas(canvas, indexed, palette, transparentIndex, 
                    offsetX, offsetY, cropW, cropH, frameW):
  For y in 0..cropH:
    For x in 0..cropW:
      idx = indexed[y * cropW + x]
      if idx != transparentIndex:
        pi = idx * 4
        ci = ((offsetY + y) * frameW + (offsetX + x)) * 4
        canvas[ci] = palette[pi]
        canvas[ci+1] = palette[pi+1]
        canvas[ci+2] = palette[pi+2]
        canvas[ci+3] = 255

decodeFrameToCanvas(canvas, indexed, palette, width, height):
  // Full frame decode (for frame 0 / keyframes)
  For each pixel i:
    pi = indexed[i] * 4
    ci = i * 4
    canvas[ci] = palette[pi]
    canvas[ci+1] = palette[pi+1]
    canvas[ci+2] = palette[pi+2]
    canvas[ci+3] = palette[pi+3]  // preserve alpha

trimPalette(indexed, palette, paletteCount, transparentIndex):
  // 1. Count used entries
  used = new Set()
  For each pixel: used.add(indexed[pixel])
  
  // 2. Power-of-2 targeting
  currentSize = paletteCount
  nextPow2 = highest power of 2 <= currentSize (256, 128, 64, 32, 16, 8, 4)
  // If we can evict enough unused entries to cross a boundary, do it
  // This reduces minCodeSize (log2(paletteSize)+1), saving bits in LZW
  
  unusedCount = paletteCount - used.size
  targetSize = currentSize
  For boundary in [128, 64, 32, 16, 8, 4]:
    if currentSize > boundary AND used.size <= boundary:
      targetSize = boundary
      break
  
  // 3. Build compacted palette + remap table
  remap = new array[paletteCount]
  newPalette = []
  newIdx = 0
  For i in 0..paletteCount:
    if used.has(i) OR newPalette.length < targetSize:
      remap[i] = newIdx
      newPalette.push(palette[i*4..i*4+4])
      newIdx++
    else:
      remap[i] = 0  // won't be referenced
  
  // 4. Remap indexed data
  For each pixel: indexed[pixel] = remap[indexed[pixel]]
  
  // Update transparentIndex
  newTransparentIndex = (transparentIndex >= 0) ? remap[transparentIndex] : -1
  
  return { palette: newPalette, paletteCount: newIdx, transparentIndex: newTransparentIndex }
```

### LZW Algorithm Detail (`lzw.ts`)

```
lzwEncode(indexed, minCodeSize):
  clearCode = 1 << minCodeSize
  eoiCode = clearCode + 1
  
  // Initialize
  codeSize = minCodeSize + 1
  nextCode = eoiCode + 1
  dictionary = new Map()  // (prefix << 8 | suffix) → code
  
  // Output buffer (bit-packed, LSB-first)
  emit(clearCode)
  
  prefix = indexed[0]
  deferCount = 0
  deferBits = 0
  
  For i in 1..indexed.length:
    suffix = indexed[i]
    key = (prefix << 8) | suffix
    
    if dictionary.has(key):
      prefix = dictionary.get(key)
    else:
      emit(prefix)
      
      if nextCode < 4096:
        dictionary.set(key, nextCode)
        if nextCode >= (1 << codeSize): codeSize++
        nextCode++
      else:
        // Dictionary full — deferred clear strategy
        deferCount++
        deferBits += codeSize
        if deferCount >= 100:
          bitsPerPixel = deferBits / deferCount
          if bitsPerPixel > 11:
            emit(clearCode)
            // Reset dictionary
            codeSize = minCodeSize + 1
            nextCode = eoiCode + 1
            dictionary.clear()
          deferCount = 0
          deferBits = 0
      
      prefix = suffix
  
  emit(prefix)
  emit(eoiCode)
  flush remaining bits
  return output bytes
```

### Lossy LZW Algorithm Detail (`lossy-lzw.ts`)

```
lzwEncodeLossy(indexed, minCodeSize, palette, lossiness):
  // Build Chebyshev distance table (256x256)
  distTable = new Uint8Array(256 * 256)
  For i in 0..paletteCount:
    For j in 0..paletteCount:
      distTable[i * 256 + j] = max(
        |palette[i*4] - palette[j*4]|,
        |palette[i*4+1] - palette[j*4+1]|,
        |palette[i*4+2] - palette[j*4+2]|
      )
  
  // Same LZW structure as standard, but with approximate matching:
  // When looking up (prefix, suffix) in dictionary:
  //   1. Try exact match first
  //   2. If no exact match, try substituting suffix with nearby colors
  //      (palette entries within lossiness distance)
  //   3. Accept the longest match found
  
  // The lossy match: for a candidate entry (prefix, altSuffix):
  //   accept if distTable[suffix][altSuffix] <= lossiness
  
  // Everything else is identical to standard LZW.
  // Deferred clear strategy is the same.
```

### GIF Writer Detail (`gif-writer.ts`)

```
writeGif(width, height, frames, options):
  buf = new GrowableBuffer()
  
  // Header
  buf.writeBytes("GIF89a")
  
  // Logical Screen Descriptor
  buf.writeU16LE(width)
  buf.writeU16LE(height)
  packed = 0x00  // no GCT
  buf.writeByte(packed)
  buf.writeByte(0)  // background color index
  buf.writeByte(0)  // pixel aspect ratio
  
  // Netscape Application Extension (infinite loop)
  buf.writeByte(0x21)  // extension introducer
  buf.writeByte(0xFF)  // application extension
  buf.writeByte(11)    // block size
  buf.writeBytes("NETSCAPE2.0")
  buf.writeByte(3)     // sub-block size
  buf.writeByte(1)     // loop indicator
  buf.writeU16LE(0)    // loop count (0 = infinite)
  buf.writeByte(0)     // block terminator
  
  For each frame:
    // Graphic Control Extension
    buf.writeByte(0x21)  // extension introducer
    buf.writeByte(0xF9)  // GCE label
    buf.writeByte(4)     // block size
    
    disposal = frame.disposal ?? 1  // 1 = do not dispose
    hasTransparency = frame.transparentIndex >= 0
    packed = (disposal << 2) | (hasTransparency ? 1 : 0)
    buf.writeByte(packed)
    
    delay = Math.round(frame.delay / 10)  // ms → centiseconds
    buf.writeU16LE(delay)
    buf.writeByte(hasTransparency ? frame.transparentIndex : 0)
    buf.writeByte(0)  // block terminator
    
    // Image Descriptor
    buf.writeByte(0x2C)  // image separator
    buf.writeU16LE(frame.x ?? 0)
    buf.writeU16LE(frame.y ?? 0)
    buf.writeU16LE(frame.width)
    buf.writeU16LE(frame.height)
    
    // Local Color Table
    paletteSize = padToPow2(frame.paletteCount)
    colorTableBits = log2(paletteSize) - 1  // 0-7
    packed = 0x80 | colorTableBits  // LCT flag + size
    buf.writeByte(packed)
    
    // Write palette (pad to power-of-2 size)
    For i in 0..paletteSize:
      if i < frame.paletteCount:
        buf.writeByte(frame.palette[i*4])    // R
        buf.writeByte(frame.palette[i*4+1])  // G
        buf.writeByte(frame.palette[i*4+2])  // B
      else:
        buf.writeByte(0); buf.writeByte(0); buf.writeByte(0)  // padding
    
    // LZW Minimum Code Size
    minCodeSize = max(2, log2(paletteSize))
    buf.writeByte(minCodeSize)
    
    // Image Data (sub-blocks)
    lzwData = lzwEncode(frame.indexed, minCodeSize)  // or lossy variant
    writeSubBlocks(buf, lzwData)  // chunks of max 255 bytes
    buf.writeByte(0)  // block terminator
  
  // Trailer
  buf.writeByte(0x3B)
  return buf.toUint8Array()

padToPow2(n):
  For size in [4, 8, 16, 32, 64, 128, 256]:
    if size >= n: return size
  return 256

writeSubBlocks(buf, data):
  offset = 0
  while offset < data.length:
    blockSize = min(255, data.length - offset)
    buf.writeByte(blockSize)
    buf.writeBytes(data.slice(offset, offset + blockSize))
    offset += blockSize
```

### Temporal Denoiser Detail

```
denoiseFrames(frames, width, height, threshold):
  numPixels = width * height
  For i in 1..frames.length-1:
    prev = frames[i-1].data
    curr = frames[i].data
    next = frames[i+1].data
    For j in 0..numPixels:
      For c in 0..3:  // R, G, B (skip alpha)
        si = j * 4 + c
        a = prev[si], b = curr[si], d = next[si]
        // Median of three
        med = a + b + d - min(a, b, d) - max(a, b, d)
        // Clamp to within ±threshold of original
        result = max(b - threshold, min(b + threshold, med))
        curr[si] = result
```

### Floyd-Steinberg Dithering Detail

```
floydSteinberg(rgba, width, height, palette, serpentine=true):
  // palette: Uint8Array of RGBA entries (paletteCount * 4 bytes)
  
  indexed = new Uint8Array(width * height)
  errR = new Float32Array(width + 4)  // current row error
  nextErrR = new Float32Array(width + 4)  // next row error
  // ... same for G, B
  
  For y in 0..height:
    // Serpentine: alternate left-to-right and right-to-left
    leftToRight = serpentine ? (y % 2 === 0) : true
    
    For x in (leftToRight ? 0..width : width-1..0):
      si = (y * width + x) * 4
      
      // Add accumulated error
      r = clamp(rgba[si] + errR[x + 2], 0, 255)
      g = clamp(rgba[si+1] + errG[x + 2], 0, 255)
      b = clamp(rgba[si+2] + errB[x + 2], 0, 255)
      
      // Find nearest palette color (L1 distance)
      bestIdx = 0, bestDist = Infinity
      For i in 0..paletteCount:
        dist = |r - palette[i*4]| + |g - palette[i*4+1]| + |b - palette[i*4+2]|
        if dist < bestDist: bestDist = dist; bestIdx = i
      
      indexed[y * width + x] = bestIdx
      
      // Compute error
      er = r - palette[bestIdx * 4]
      eg = g - palette[bestIdx * 4 + 1]
      eb = b - palette[bestIdx * 4 + 2]
      
      // Distribute error (Floyd-Steinberg weights)
      // Direction depends on serpentine
      dx = leftToRight ? 1 : -1
      errR[x + 2 + dx] += er * 7/16      // right (or left)
      nextErrR[x + 2 - dx] += er * 3/16  // below-left (or below-right)
      nextErrR[x + 2] += er * 5/16       // below
      nextErrR[x + 2 + dx] += er * 1/16  // below-right (or below-left)
      // ... same for G, B
    
    // Swap error rows
    swap(errR, nextErrR); nextErrR.fill(0)
    // ... same for G, B
  
  return indexed
```

## Parallelization Strategy (Rayon)

### What parallelizes (per-frame, no dependencies)
```rust
// Phase 1: Lanczos3 downscale — all frames independent
let resized: Vec<Vec<u8>> = frames.par_iter()
    .map(|f| downsample_lanczos3(f, src_w, src_h, dst_w, dst_h))
    .collect();

// Phase 2: Probe — sequential (reads all frames)
let probe = probe_frames(&resized, width, height, tolerance);

// Phase 3: Build shared palette — sequential (pools all frames)
let palette = build_shared_palette(&sampled, width, height, quality, speed, max_colors);

// Phase 4: Quantize + dither — all frames independent when using shared palette
let quantized: Vec<QuantResult> = frames.par_iter()
    .map(|f| remap_with_palette(f, width, height, &palette, &canvas_approx, 1.0))
    .collect();

// Phase 5: Sub-frame + LZW — sequential (canvas state depends on previous frame)
// BUT: LZW per frame is independent if we pre-compute the indexed data
// Strategy: sequential sub-frame pass, then parallel LZW
let subframes = sequential_subframe_pass(&quantized, &probe, width, height, ...);
let lzw_data: Vec<Vec<u8>> = subframes.par_iter()
    .map(|sf| lzw_encode_lossy(&sf.indexed, sf.min_code_size, &sf.palette, lossy))
    .collect();

// Phase 6: GIF assembly — sequential (byte stream)
write_gif(width, height, &subframes, &lzw_data, ...)
```

### Canvas approximation for parallel quantization
When using shared palette, frames are quantized with `remap_with_palette(frame, palette, background)`. The true `background` (decoded canvas) depends on all previous frames — sequential.

**Approximation:** use the source pixels of frame N-1 as the background for frame N. The difference between source and decoded canvas is quantization error (1-3 per channel), which is within staleThreshold. This was validated in the TS pipeline — produces identical VMAF scores.

For keyframes: background is empty (all zeros). Canvas resets.

## CLI Design

```
gifhero encode <input> [options]

Arguments:
  <input>              Video file (any format ffmpeg supports)

Options:
  -o, --output <path>  Output GIF path [default: input.gif]
  -w, --width <px>     Target width (height auto from aspect ratio)
  -h, --height <px>    Target height (width auto from aspect ratio)
  --fps <n>            Frames per second [default: 20]
  --preset <name>      quality | balanced [default: balanced]
  --max-duration <s>   Maximum duration in seconds
  -j, --threads <n>    Worker threads [default: all cores]
  -q, --quiet          Suppress progress output
  --json               Output stats as JSON
```

### CLI implementation (`main.rs`)
1. Parse args with clap
2. Run ffmpeg to extract frames: `ffmpeg -i input -vf fps=N,scale=W:-1 -f rawvideo -pix_fmt rgba pipe:1`
3. Read raw RGBA frames from stdout pipe
4. Call `encode(frames, opts)` with Rayon thread pool
5. Write GIF to output file
6. Print stats: size, time, frame count

## WASM Exports (`wasm.rs`)

Replace current fine-grained exports with a single high-level entry point:

```rust
#[wasm_bindgen]
pub fn encode(
    frames_rgba: &[u8],      // all frames concatenated
    frame_count: u32,
    width: u32,
    height: u32,
    delay_ms: u32,           // per-frame delay
    target_width: u32,       // 0 = no resize
    preset: u8,              // 0 = balanced, 1 = quality
) -> Vec<u8>                 // complete GIF file
```

The browser SDK calls this single function instead of orchestrating probe → quantize → subframe → LZW in JavaScript.

**Keep the old fine-grained exports too** (`quantize_simple`, `downsample_lanczos3`, etc.) for the transition period while both pipelines coexist.

## Porting Phases

### Phase 1: Probe + Denoise (~300 LOC Rust, 2h)
- Port `probeFrames()` and `denoiseFrames()` to Rust
- Test: call from TS via WASM, compare ProbeResult fields against JS version
- Fixture: use 3-4 test fixtures, assert exact match on staticMask, motionLevel, colorComplexity, keyframes

### Phase 2: LZW + Lossy LZW + GIF Writer (~570 LOC Rust, 4h)
- Port `lzwEncode`, `lzwEncodeLossy`, `writeGif`
- Test: take a pre-quantized frame (indexed + palette), encode to GIF in both JS and Rust, compare bytes
- The GIF binary output must be byte-identical

### Phase 3: Sub-frame Pipeline (~370 LOC Rust, 4h)
- Port `findChangedBbox`, `buildSubframe`, `compositeOntoCanvas`, `trimPalette`
- Port `encodeSubframePipeline` orchestrator
- Test: full encode of test fixtures, compare GIF output byte-for-byte against TS pipeline
- This is the hardest phase — many edge cases in transparency decisions

### Phase 4: Rayon Parallelism (~100 LOC Rust, 2h)
- Add `rayon` dependency behind `cli` feature
- Parallelize: Lanczos3 (par_iter), quantization (par_iter), LZW (par_iter)
- Keep sub-frame sequential (canvas dependency)
- Benchmark: should be 6-10x faster than single-threaded

### Phase 5: CLI (~150 LOC Rust, 2h)
- Add `clap` for arg parsing
- ffmpeg subprocess for frame extraction
- Read raw RGBA from pipe
- Progress bar on stderr
- `gifhero encode input.mp4 -w 480 --fps 20 -o output.gif`

### Phase 6: WASM Integration (~100 LOC Rust, 2h)
- Add `encode()` high-level WASM export
- Update `src/wasm/gifhero-core/` glue
- Update browser SDK to call new WASM instead of TS pipeline
- Verify browser benchmark produces same results

## Validation Checklist

After each phase, run:
```bash
# Unit: compare Rust output against TS for specific inputs
npm run test

# Full benchmark: 25 fixtures × 4 resolutions
npm run bench

# Verify: no VMAF regression (all within ±0.1 of TS pipeline)
# Verify: file sizes within ±1% of TS pipeline (rounding differences OK)
# Verify: byte-identical GIF output for at least 3 fixtures
```

## Expected Performance

| Target | Time (333 frames, 1080p→480p) | Notes |
|--------|-------------------------------|-------|
| TS pipeline (browser) | 29s | Current: single-threaded WASM |
| Rust WASM (browser) | ~20s | Less JS overhead, same single-threaded |
| Rust native (1 thread) | ~15s | Native speed, no WASM overhead |
| Rust native (16 threads) | ~3s | Rayon: parallel quantize + Lanczos3 + LZW |
| gifski CLI (16 threads) | 4s | Our target to beat |

## Files That Stay in TypeScript

These are browser-only concerns and don't move to Rust:
- `src/browser/index.ts` — fluent API (fromFile, fromCanvas, etc.)
- `src/browser/builder.ts` — GifHeroBuilder class
- `src/browser/worker/video-worker.ts` — VideoDecoder + Mediabunny
- `src/browser/worker/encode-worker.ts` — Worker wrapper
- `src/browser/sources/*.ts` — VideoSource, FileSource, StreamSource
- `src/wasm/gifhero-core/gifhero-core-wasm.ts` — ESM glue for WASM loading
- `src/resize.ts` — pure JS Lanczos3 fallback (exported for external use)
