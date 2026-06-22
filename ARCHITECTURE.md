# gifhero — Technical Architecture

A comprehensive blueprint for a browser-first, TypeScript-native GIF encoding library that combines every known state-of-the-art technique into a single package. The gold standard to beat is **gifski** (Rust, by Kornel Lesiński / pngquant author), which currently produces the highest-quality GIFs in existence. No JavaScript library comes close. gifhero aims to change that.

---

## Why gifhero Needs to Exist

The current JS GIF encoding landscape is fractured and outdated:

| Library | Quantizer | Dithering | Frame Diff | Lossy LZW | Temporal Dithering | Maintained |
|---|---|---|---|---|---|---|
| gif.js | NeuQuant | ✅ 4 methods | ❌ | ❌ | ❌ | ❌ (~2017) |
| gifenc | PnnQuant | ❌ | ❌ | ❌ | ❌ | ❌ (~2021) |
| gif-encoder-2 | NeuQuant + Octree | ❌ | ❌ | ❌ | ❌ | ❌ (~2019) |
| modern-gif | Basic | ❌ | ❌ | ❌ | ❌ | ✅ |
| **gifski (Rust)** | **libimagequant** | **✅ Unique** | **✅** | **✅** | **✅** | **✅** |
| **gifhero** | **Multiple + WASM** | **✅ 6+ methods** | **✅** | **✅** | **✅** | **✅** |

No JS library implements frame differencing, temporal dithering, lossy LZW, or cross-frame palette optimization. gifhero implements all of them.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Public API                        │
│  encode(frames, options) → Uint8Array | ReadableStream│
├─────────────────────────────────────────────────────┤
│              Orchestrator / Pipeline                 │
│  (coordinates all layers, manages workers)           │
├──────────┬──────────┬───────────┬───────────────────┤
│ Layer 1  │ Layer 2  │ Layer 3   │ Layer 4           │
│ Quantize │ Dither   │ Optimize  │ Encode            │
│          │          │ Frames    │ LZW + Binary      │
├──────────┴──────────┴───────────┴───────────────────┤
│              Worker Pool (Web Workers)               │
├─────────────────────────────────────────────────────┤
│         WASM Acceleration (optional)                 │
│    libimagequant-wasm / custom WASM modules          │
└─────────────────────────────────────────────────────┘
```

---

## Layer 1: Color Quantization

The single most important factor in GIF quality. Reducing 16.7M colors to ≤256 per frame.

### 1.1 Quantization Algorithms (user-selectable)

**Tier 1 — Highest Quality:**

- **libimagequant (via WASM)**: The same engine behind pngquant and gifski. Uses a modified median-cut algorithm optimized for human perception, with gamma correction and premultiplied alpha support. Produces the best palettes of any known quantizer. Available as a ~500KB WASM module (`imagequant-wasm`, `@fe-daily/libimagequant-wasm`). Quality range 0–100 (like JPEG), speed 1–10.

- **NeuQuant**: Neural network-based quantizer. Excellent for photographic/video content. Learns perceptually important colors by training on the image data. Quality parameter controls sampling rate (lower = better but slower). The quantizer used by gif.js.

**Tier 2 — Good Balance:**

- **PnnQuant (Pairwise Nearest Neighbor)**: Fast, produces good results for many image types. The quantizer used by gifenc. Based on academic clustering research. Best for content with distinct color regions.

- **Octree**: Tree-based quantizer that recursively subdivides the color space. Produces smaller file sizes than NeuQuant (often ~50% smaller) because it creates more compressible palettes. The quantizer added by gif-encoder-2.

**Tier 3 — Fast/Specialized:**

- **Median Cut (Heckbert)**: Classic algorithm. Fast, decent quality. Good fallback when WASM isn't available.

- **Wu's Quantizer**: Minimizes variance in each color bucket. Good for images with smooth gradients.

- **K-Means Refinement**: Not a standalone quantizer, but a post-processing pass that iteratively refines any palette by reassigning pixels to nearest colors and recomputing centroids. Improves any palette at the cost of extra iterations.

### 1.2 Palette Strategies

The palette strategy determines how color tables are allocated across frames. This is where gifski's quality advantage primarily comes from.

**Per-Frame (Local) Palettes:**
Each frame gets its own optimized 256-color palette. Maximum quality, largest file size. Every frame uses the full 256 colors for its own content.

**Global Palette:**
One palette shared across all frames. Smallest file size, worst quality. Colors must compromise across all frames, so individual frames may look washed out.

**Cross-Frame Palette Optimization (gifski approach):**
The key innovation. When building the palette for frame N:
1. Analyze the pixel data of frames N-1, N, and N+1
2. Weight pixel importance by how long they appear on screen (a pixel visible for 5 frames matters more than one visible for 1 frame)
3. Identify colors shared across adjacent frames and prioritize them
4. Reserve palette slots for colors unique to this frame
5. Result: each frame gets a local palette, but palettes across adjacent frames share many colors, enabling smoother temporal transitions and better LZW compression of deltas

**Adaptive Hybrid:**
Start with a global palette computed from a subset of frames (e.g., every 10th frame). For each frame, check if the global palette produces acceptable quality (measure via SSIM or color distance). If not, generate a local palette. This minimizes file size while maintaining quality where it matters.

**Palette Reuse Detection (gif-encoder-2 approach):**
For consecutive frames, compute a similarity metric. If frames are similar enough (common in video), reuse the previous frame's palette entirely, skipping the expensive quantization step. The similarity check is much cheaper than re-quantizing.

### 1.3 Pre-Quantization

Before quantizing, optionally reduce the input color space to speed up quantization without visible quality loss:

- **rgb444**: Reduce 24-bit RGB to 12-bit (4096 colors). Very fast, good for most content.
- **rgb565**: Reduce to 16-bit (65536 colors). Better quality, slower.
- **rgba4444**: Same as rgb444 but preserving alpha information.

gifenc uses this approach and it's a significant performance win.

---

## Layer 2: Dithering

Dithering creates the illusion of more colors by mixing adjacent pixels. Critical for video content where gradients and smooth tones are common.

### 2.1 Spatial Dithering (within a single frame)

**Error Diffusion (best quality, slower):**

- **Floyd-Steinberg**: The standard. Distributes error to 4 neighboring pixels with weights 7/16, 3/16, 5/16, 1/16. Best general-purpose option.
- **Stucki**: Distributes error to 12 neighbors over a larger area. Smoother gradients, less visible patterns. Slightly slower.
- **Atkinson**: Distributes only 3/4 of the error (the rest is discarded). Creates a lighter, more stylized look. Originally designed for 1-bit displays. Good for retro aesthetics.
- **Sierra (Full/Two-Row/Lite)**: Family of kernels with different neighborhood sizes. Sierra Lite is a good speed/quality compromise.
- **Burkes**: Distributes to 7 neighbors. Good balance between Floyd-Steinberg and Stucki.

All error-diffusion methods should support **serpentine scanning** — alternating left-to-right and right-to-left on each row. This eliminates directional artifacts that are visible when error is always pushed in one direction.

**Ordered Dithering (faster, deterministic):**

- **Bayer Matrix** (2×2, 4×4, 8×8): Creates a regular pattern. Deterministic, no error propagation, very fast. Produces a characteristic crosshatch look. Good for pixel art or retro aesthetics.

**libimagequant Dithering:**
When using the WASM quantizer, libimagequant has its own built-in dithering that is specifically designed to minimize visual noise. It does not add unnecessary noise to the image. This is the highest-quality option when WASM is available.

### 2.2 Temporal Dithering (across frames) — THE KEY INNOVATION

This is gifski's secret weapon and no JS library implements it.

Standard spatial dithering treats each frame independently. This means adjacent frames may dither the same pixel in completely different patterns, creating visible flickering/shimmering in the animation.

Temporal dithering solves this by:

1. **Error tracking across frames**: When frame N is dithered, the quantization error for each pixel is stored. When frame N+1 is processed, this stored error is added to the initial error for the corresponding pixel before spatial dithering begins.

2. **Temporal error diffusion**: Instead of distributing all error spatially (to neighboring pixels in the same frame), distribute some percentage temporally (to the same pixel in the next frame). A typical split might be 70% spatial, 30% temporal.

3. **Frame-aware palette selection**: When selecting which palette color to map a pixel to, consider what color was used for that pixel in the previous frame. If two palette colors are equally close, prefer the one that was used in the previous frame to reduce flickering.

4. **Threshold-based temporal smoothing**: If a pixel's color changed by less than a perceptual threshold between frames, force it to use the same palette index as the previous frame. This eliminates dither flickering in areas that haven't meaningfully changed.

Implementation approach:
```
for each frame N:
  for each pixel (x, y):
    actual_color = frame[N].pixel(x, y)
    temporal_error = error_buffer[x][y]  // from previous frame
    adjusted_color = actual_color + temporal_error * temporal_weight
    palette_index = find_nearest(adjusted_color, palette)
    quantized_color = palette[palette_index]
    total_error = actual_color - quantized_color
    
    // Distribute error spatially (e.g., Floyd-Steinberg)
    distribute_spatial(total_error * spatial_weight, neighbors)
    
    // Store temporal error for next frame
    error_buffer[x][y] = total_error * temporal_weight
```

The `temporal_weight` parameter (0.0–1.0) controls the balance. Higher values produce smoother animations but may cause "ghosting" in fast-moving areas. A value of 0.2–0.3 works well for most video content.

---

## Layer 3: Frame Optimization

These techniques reduce file size without affecting visual quality (or with controlled quality loss).

### 3.1 Frame Differencing (Delta Encoding)

Instead of storing complete frames, store only the pixels that changed.

**Algorithm:**
```
for each frame N (starting from frame 1):
  for each pixel (x, y):
    if pixel_matches(frame[N], frame[N-1], x, y, tolerance):
      mark as transparent (unchanged)
    else:
      keep original pixel
  crop frame to bounding box of changed pixels
```

The `tolerance` parameter controls how similar pixels need to be to count as "unchanged." A tolerance of 0 is lossless. A tolerance of 2–5 (in RGB distance) is visually lossless but can dramatically increase the number of "unchanged" pixels.

**Bounding Box Cropping:**
After marking unchanged pixels as transparent, compute the minimal bounding rectangle that contains all changed pixels. The GIF frame only needs to encode this rectangle (with offset coordinates), not the full canvas.

Impact: For typical video content with static backgrounds or slow motion, this can reduce file size by 40–70%.

### 3.2 Disposal Method Optimization

GIF supports three relevant disposal methods per frame:

- **0 / None**: Leave the frame in place (overlay next frame on top)
- **1 / Do Not Dispose**: Same as None functionally
- **2 / Restore to Background**: Clear the frame area to background color before drawing next frame
- **3 / Restore to Previous**: Restore the canvas to the state before this frame was drawn

Choosing the optimal disposal method per frame is a combinatorial optimization problem. The algorithm:

```
for each frame N:
  compute delta_with_dispose_none = diff(composite(frame[N-1], frame[N]), frame[N+1])
  compute delta_with_dispose_bg = diff(background, frame[N+1])
  compute delta_with_dispose_prev = diff(frame[N-1], frame[N+1])
  
  choose disposal method that minimizes delta size for frame N+1
```

This is the technique described in a Google patent for animated GIF optimization. The insight is that the disposal method of frame N affects how much data frame N+1 needs to encode, so you optimize backwards.

### 3.3 Transparency Optimization

In delta-encoded frames, unchanged pixels are marked as transparent. The LZW compressor can encode runs of the same transparent index very efficiently. To maximize this:

- **Cluster transparent pixels**: After delta encoding, some "changed" pixels may be surrounded by transparent pixels. If the changed pixel is very close to the background, it may be worth making it transparent too (lossy, controlled by tolerance).
- **Reorder palette**: Put the transparent color index at position 0. Some LZW implementations produce slightly better compression when the most common index is low.

### 3.4 Color Substitution for LZW Friendliness

After quantization and dithering, scan the indexed pixel data. For each pixel, if a neighboring pixel has a different palette index but maps to a perceptually identical color (within threshold), substitute it to match the neighbor. This creates longer runs of identical indices, which LZW compresses much better.

The lossy GIF approach from gifsicle's author (Kornel Lesiński): "The normal encoder searches the LZW dictionary for the longest string of pixels that exactly matches pixels in the image. The lossy encoder picks the longest string that's 'similar enough', plus some magic to hide the distortions with dithering."

### 3.5 Intelligent Frame Rate Reduction

For video sources, analyze frame-to-frame differences:
- If consecutive frames are nearly identical (SSIM > 0.99), drop the duplicate and extend the previous frame's delay
- If the source is 30fps but the content only meaningfully changes at 15fps (e.g., animation), auto-detect and reduce
- Expose this as a `maxFps` option with intelligent frame dropping (not just naive nth-frame selection — keep frames with the most visual change)

---

## Layer 4: Binary Encoding

### 4.1 GIF89a Writer

A correct, spec-compliant writer for the GIF89a binary format:

- **Header**: `GIF89a` magic bytes
- **Logical Screen Descriptor**: Canvas width, height, global color table flag, color resolution, background color index
- **Global Color Table** (optional): Shared palette for all frames
- **Application Extension**: Netscape 2.0 looping extension (loop count)
- **Per-frame blocks**:
  - Graphic Control Extension (delay, disposal, transparent index)
  - Image Descriptor (position, size, local color table flag, interlace)
  - Local Color Table (optional, per-frame palette)
  - Image Data (LZW-compressed indexed pixels)
- **Trailer**: `0x3B` end-of-stream

### 4.2 LZW Compression

**Standard LZW:**
Implement the standard GIF LZW algorithm with variable-width codes (starting at min code size + 1, growing to max 12 bits). The clear code resets the dictionary, the EOI code marks end of data.

**Lossy LZW (gifsicle approach):**
The lossy modification changes the dictionary lookup step. Instead of finding the exact longest match, find the longest "close enough" match:

```
function findLongestMatch(pixels, position, dictionary, lossiness):
  bestMatch = null
  for each entry in dictionary:
    if entry.length > bestMatch.length:
      if maxPixelDifference(pixels[position..], entry.pixels) <= lossiness:
        bestMatch = entry
  return bestMatch
```

Where `lossiness` (0–200) controls how different a dictionary entry can be from the actual pixels. Low values (20–30) are nearly invisible. High values (100–200) produce visible artifacts but much smaller files.

**Optimal Clear Code Placement (flexiGIF approach):**
Standard encoders emit a clear code when the dictionary fills up (at 4096 entries). This is suboptimal. Instead:
- Use one-step lookahead: before emitting a clear code, check if the next pixel sequence is already in the dictionary. If so, don't clear yet — the existing dictionary is still useful.
- Try multiple clear code positions and pick the one that produces the smallest output.

This is the most expensive optimization (flexiGIF is "magnitudes slower" than standard encoders). Make it optional, exposed as a `maxCompression` flag.

### 4.3 Interlacing

GIF supports interlaced rendering (display rows in 4 passes: 0, 8, 16... then 4, 12, 20... etc.). For animated GIFs this is rarely useful, but for single-frame GIFs or the first frame of an animation it can improve perceived loading speed. Expose as an option, default off for animations.

---

## Layer 5: Performance Architecture

### 5.1 Web Worker Pool

GIF encoding is CPU-bound. The library should parallelize across cores:

```
Main Thread                Worker Pool (N workers)
─────────                  ──────────────────────
                           Worker 1: quantize + dither frame 0
  send frame 0 ──────────► Worker 2: quantize + dither frame 1
  send frame 1 ──────────► Worker 3: quantize + dither frame 2
  send frame 2 ──────────► Worker 4: quantize + dither frame 3
                           ...
  ◄── receive indexed 0    (results may arrive out of order)
  ◄── receive indexed 1
  ◄── receive indexed 2
  ◄── receive indexed 3
                           
  LZW encode sequentially  (must be in order for delta encoding)
  (or parallelize with     
   dependency tracking)    
```

**Important constraint**: Temporal dithering requires sequential frame processing (frame N depends on N-1's error buffer). Two approaches:
1. **Disable parallelism for temporal dithering** — process frames sequentially in a single worker (simpler, slower)
2. **Two-pass pipeline** — first pass: parallel quantization + spatial dithering. Second pass: sequential temporal smoothing on the indexed frames (more complex, faster)

### 5.2 WASM Acceleration

Performance-critical paths that benefit from WASM:
- **libimagequant**: Quantization is the bottleneck. WASM is 5–10x faster than pure JS for this.
- **LZW compression**: The dictionary lookup/encoding loop is tight and benefits from WASM.
- **Pixel diffing**: Frame differencing involves iterating every pixel. SIMD-accelerated WASM can process 4–16 pixels at once.

Architecture: WASM modules are optional. The library should detect availability and fall back to pure JS:
```
const quantizer = hasWasm 
  ? new WasmQuantizer(wasmModule) 
  : new NeuQuantizer();
```

### 5.3 Streaming Output

For large animations, don't buffer the entire GIF in memory. Emit bytes as frames are encoded:

```typescript
const stream = encoder.encodeStream(frames, options);
const reader = stream.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // value is a Uint8Array chunk
  appendToFile(value);
}
```

This requires writing the GIF header and global color table first, then each frame as it's ready. The stream can start emitting bytes before all frames are processed.

### 5.4 Memory Management

Video frames are large (1920×1080 RGBA = 8.3MB per frame). Key strategies:
- Process frames in batches, not all at once
- Release source frame data as soon as it's been quantized
- Use `Uint8Array` for indexed pixel data (1 byte/pixel vs 4 bytes/pixel for RGBA)
- Reuse buffers between frames where possible (error diffusion buffers, temporary palettes)
- Use `Transferable` objects when sending data to/from workers (zero-copy)

---

## Public API Design

```typescript
// Simple one-shot encode
const gif = await encode({
  width: 640,
  height: 480,
  frames: [
    { data: canvasOrImageData, delay: 100 },
    { data: canvasOrImageData, delay: 100 },
  ],
  
  // Quality presets (override individual settings)
  preset: 'quality' | 'balanced' | 'speed' | 'filesize',
  
  // Or fine-grained control:
  quantizer: 'imagequant' | 'neuquant' | 'pnnquant' | 'octree' | 'mediancut',
  maxColors: 256,            // 2–256
  
  dither: 'floyd-steinberg' | 'stucki' | 'atkinson' | 'sierra' | 'bayer' | false,
  ditherSerpentine: true,
  ditherStrength: 1.0,       // 0.0–1.0
  
  temporalDither: true,      // cross-frame dithering
  temporalWeight: 0.25,      // 0.0–1.0
  
  palette: 'local' | 'global' | 'crossframe' | 'adaptive',
  
  optimize: {
    frameDiff: true,          // delta encoding
    frameDiffTolerance: 2,    // 0 = lossless, 2–5 = visually lossless
    disposalOptimize: true,   // choose optimal disposal per frame
    transparencyOptimize: true,
    colorSubstitution: true,  // LZW-friendly color merging
  },
  
  lossyLzw: 0,               // 0 = off, 20–200 = lossy level
  maxCompression: false,      // enable optimal clear code placement (slow)
  
  maxFps: 20,                // auto-drop frames if source is higher
  loop: 0,                   // 0 = forever, -1 = no loop, N = N times
  
  // Performance
  workers: navigator.hardwareConcurrency || 4,
  useWasm: true,             // auto-detect and use WASM modules
  
  // Callbacks
  onProgress: (percent: number, phase: string) => void,
});

// Streaming encode
const stream = encodeStream({ ...options, frames: asyncFrameIterator });

// Analyze quality before encoding
const analysis = analyzeFrames(frames, options);
// Returns: { estimatedSize, colorComplexity, motionLevel, recommendedPreset }
```

---

## Presets

Presets provide sensible defaults for common use cases:

**`quality` (gifski-equivalent):**
```
quantizer: 'imagequant', maxColors: 256, dither: built-in,
temporalDither: true, temporalWeight: 0.25,
palette: 'crossframe', optimize: all on, frameDiffTolerance: 0,
lossyLzw: 0, maxCompression: true
```

**`balanced` (default):**
```
quantizer: 'neuquant', maxColors: 256, dither: 'floyd-steinberg',
temporalDither: true, temporalWeight: 0.2,
palette: 'adaptive', optimize: all on, frameDiffTolerance: 2,
lossyLzw: 0, maxCompression: false
```

**`speed`:**
```
quantizer: 'pnnquant', maxColors: 256, dither: false,
temporalDither: false,
palette: 'global', optimize: frameDiff only, frameDiffTolerance: 5,
lossyLzw: 0, maxCompression: false
```

**`filesize`:**
```
quantizer: 'octree', maxColors: 128, dither: 'floyd-steinberg',
temporalDither: false,
palette: 'global', optimize: all on, frameDiffTolerance: 5,
lossyLzw: 80, maxCompression: true, maxFps: 12
```

---

## Implementation Priority

Ordered by impact-to-effort ratio:

### Phase 1 — Foundation (weeks 1–3)
1. GIF89a binary writer (headers, frames, LZW, looping)
2. NeuQuant quantizer (proven, well-documented algorithm)
3. Floyd-Steinberg dithering with serpentine scanning
4. Per-frame local palettes
5. Basic Web Worker support
6. TypeScript throughout, ESM + CJS exports

### Phase 2 — Optimization (weeks 4–6)
7. Frame differencing (delta encoding)
8. Bounding box cropping
9. Disposal method optimization
10. Transparency optimization
11. PnnQuant quantizer (port from gifenc, it's fast)
12. Additional dithering methods (Stucki, Atkinson, Sierra, Bayer)

### Phase 3 — Advanced Quality (weeks 7–10)
13. Temporal dithering
14. Cross-frame palette optimization
15. libimagequant WASM integration (optional dependency)
16. Lossy LZW compression
17. Palette reuse detection
18. Color substitution for LZW friendliness

### Phase 4 — Polish (weeks 11–13)
19. Streaming output
20. Optimal clear code placement (maxCompression mode)
21. Intelligent frame rate reduction
22. Analysis/recommendation API
23. Presets system
24. K-Means palette refinement pass

---

## Testing and Benchmarking

### Quality Metrics
- **SSIM** (Structural Similarity): Compare each GIF frame against original. Target: >0.92 for balanced, >0.96 for quality preset.
- **DSSIM** (perceptual distance): Lower is better. Gifski typically achieves 0.001–0.01.
- **Color histogram distance**: Measure how well the palette represents the source.
- **Temporal flicker metric**: Measure frame-to-frame palette index changes in static regions. Lower = smoother animation.

### Benchmark Suite
Test against:
- gifski (Rust CLI, gold standard)
- gif.js (current best JS quality)
- gifenc (current fastest JS)
- FFmpeg palettegen/paletteuse (common CLI pipeline)

Test content:
- Screen recordings (flat colors, text, UI elements)
- Live-action video clips (skin tones, gradients, motion blur)
- Animation/cartoon content (flat colors, hard edges)
- High-motion content (sports, gaming)

### Size Budget
- Core library (no WASM): < 50KB gzipped
- With libimagequant WASM: + ~500KB for the .wasm file
- Worker scripts: bundled inline via Blob URLs (no separate files needed)

---

## Licensing Considerations

- **libimagequant**: GPL v3 or commercial license. If distributing as part of a Chrome extension, the extension must also be GPL, or you need a commercial license from pngquant.org. The pure-JS quantizers (NeuQuant, PnnQuant, Octree) have permissive licenses.
- **LZW**: The original Unisys patent expired in 2003/2004. No licensing concerns.
- **Lossy GIF technique**: Kornel's lossy GIF encoder is GPL. Implementing the technique independently (from the published description) should be fine under a clean-room approach, but IANAL.

Recommended: MIT license for the core library, with libimagequant WASM as an optional peer dependency that users install separately (and accept the GPL implications).

---

## Summary

gifhero would be the first JavaScript GIF encoder to combine:
1. **Multiple quantization algorithms** including WASM-accelerated libimagequant
2. **Temporal dithering** (currently only gifski does this)
3. **Cross-frame palette optimization** (currently only gifski does this)
4. **Frame differencing with disposal optimization** (no JS library does this)
5. **Lossy LZW compression** (only gifsicle does this, in C)
6. **Modern TypeScript API** with streaming, workers, and presets

The result would be a library that produces GIFs competitive with gifski's output quality while running entirely in the browser — something that doesn't exist today.
