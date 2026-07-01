use wasm_bindgen::prelude::*;
use imagequant::RGBA;
use std::f64::consts::PI;

#[wasm_bindgen]
pub struct QuantResult {
    palette: Vec<u8>,
    indices: Vec<u8>,
    palette_count: usize,
    transparent_index: i32,
}

#[wasm_bindgen]
impl QuantResult {
    #[wasm_bindgen(getter)]
    pub fn palette(&self) -> Vec<u8> {
        self.palette.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u8> {
        self.indices.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn palette_count(&self) -> usize {
        self.palette_count
    }

    #[wasm_bindgen(getter)]
    pub fn transparent_index(&self) -> i32 {
        self.transparent_index
    }
}

fn build_result(palette: &[RGBA], indices: Vec<u8>) -> QuantResult {
    let palette_count = palette.len();
    let mut palette_bytes = Vec::with_capacity(palette_count * 4);
    let mut transparent_index: i32 = -1;
    for (i, color) in palette.iter().enumerate() {
        palette_bytes.push(color.r);
        palette_bytes.push(color.g);
        palette_bytes.push(color.b);
        palette_bytes.push(color.a);
        if color.a == 0 && transparent_index < 0 {
            transparent_index = i as i32;
        }
    }
    QuantResult { palette: palette_bytes, indices, palette_count, transparent_index }
}

fn do_quantize(
    rgba: &[u8], width: u32, height: u32,
    quality_min: u32, quality_max: u32, speed: i32, max_colors: u32,
    background_rgba: &[u8], importance_map: &[u8], dither: f32,
) -> Result<QuantResult, JsValue> {
    let w = width as usize;
    let h = height as usize;
    if rgba.len() != w * h * 4 {
        return Err(JsValue::from_str("rgba size mismatch"));
    }

    let mut attr = imagequant::Attributes::new();
    attr.set_quality(quality_min as u8, quality_max as u8)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    attr.set_speed(speed)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    attr.set_max_colors(max_colors as u32)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    let pixels: Vec<RGBA> = rgba.chunks_exact(4)
        .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
        .collect();

    let mut img = attr.new_image(pixels, w, h, 0.0)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    if background_rgba.len() == w * h * 4 {
        let bg_pixels: Vec<RGBA> = background_rgba.chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();
        let bg_img = attr.new_image(bg_pixels, w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        img.set_background(bg_img)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    }

    if importance_map.len() == w * h {
        img.set_importance_map(importance_map.to_vec())
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    }

    let mut res = attr.quantize(&mut img)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    res.set_dithering_level(dither)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    let (palette, indices) = res.remapped(&mut img)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    Ok(build_result(&palette, indices))
}

// ── Per-frame quantization (existing API) ───────────────────────

#[wasm_bindgen]
pub fn quantize_with_background(
    rgba: &[u8], width: u32, height: u32,
    quality_min: u32, quality_max: u32, speed: i32, max_colors: u32,
    background_rgba: &[u8], importance_map: &[u8],
) -> Result<QuantResult, JsValue> {
    do_quantize(rgba, width, height, quality_min, quality_max, speed, max_colors,
        background_rgba, importance_map, 1.0)
}

#[wasm_bindgen]
pub fn quantize_simple(
    rgba: &[u8], width: u32, height: u32,
    quality_min: u32, quality_max: u32, speed: i32, max_colors: u32,
) -> Result<QuantResult, JsValue> {
    do_quantize(rgba, width, height, quality_min, quality_max, speed, max_colors,
        &[], &[], 1.0)
}

#[wasm_bindgen]
pub fn quantize_no_dither(
    rgba: &[u8], width: u32, height: u32,
    quality_min: u32, quality_max: u32, speed: i32, max_colors: u32,
    background_rgba: &[u8], importance_map: &[u8],
) -> Result<QuantResult, JsValue> {
    do_quantize(rgba, width, height, quality_min, quality_max, speed, max_colors,
        background_rgba, importance_map, 0.0)
}

// ── Shared palette API (new) ────────────────────────────────────

/// Build a shared palette from multiple sampled frames.
/// Takes a flat array of RGBA frame data concatenated together,
/// with frame_count indicating how many frames are in the array.
/// Each frame is width × height × 4 bytes.
#[wasm_bindgen]
pub fn build_shared_palette(
    frames_rgba: &[u8],
    width: u32,
    height: u32,
    frame_count: u32,
    quality_min: u32,
    quality_max: u32,
    speed: i32,
    max_colors: u32,
) -> Result<Vec<u8>, JsValue> {
    let w = width as usize;
    let h = height as usize;
    let frame_size = w * h * 4;
    let fc = frame_count as usize;

    if frames_rgba.len() != frame_size * fc {
        return Err(JsValue::from_str("frames_rgba size mismatch"));
    }

    let mut attr = imagequant::Attributes::new();
    attr.set_quality(quality_min as u8, quality_max as u8)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    attr.set_speed(speed)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    attr.set_max_colors(max_colors)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    let mut hist = imagequant::Histogram::new(&attr);

    for f in 0..fc {
        let start = f * frame_size;
        let pixels: Vec<RGBA> = frames_rgba[start..start + frame_size]
            .chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();
        let mut img = attr.new_image(pixels, w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        hist.add_image(&attr, &mut img)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    }

    let mut res = hist.quantize(&attr)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    let palette = res.palette_vec();
    let mut palette_bytes = Vec::with_capacity(palette.len() * 4);
    for color in &palette {
        palette_bytes.push(color.r);
        palette_bytes.push(color.g);
        palette_bytes.push(color.b);
        palette_bytes.push(color.a);
    }

    Ok(palette_bytes)
}

/// Remap a frame using a pre-built shared palette, with background
/// awareness for seamless transparency.
#[wasm_bindgen]
pub fn remap_with_palette(
    rgba: &[u8],
    width: u32,
    height: u32,
    palette_rgba: &[u8],
    background_rgba: &[u8],
    dither: f32,
) -> Result<QuantResult, JsValue> {
    let w = width as usize;
    let h = height as usize;
    if rgba.len() != w * h * 4 {
        return Err(JsValue::from_str("rgba size mismatch"));
    }
    if palette_rgba.len() % 4 != 0 || palette_rgba.is_empty() {
        return Err(JsValue::from_str("palette must be non-empty RGBA"));
    }

    let mut palette_colors: Vec<RGBA> = palette_rgba.chunks_exact(4)
        .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
        .collect();

    // Ensure a transparent entry exists for background-aware remapping
    if !palette_colors.iter().any(|c| c.a == 0) {
        palette_colors.push(RGBA { r: 0, g: 0, b: 0, a: 0 });
    }

    let attr = imagequant::Attributes::new();

    let mut res = imagequant::QuantizationResult::from_palette(&attr, &palette_colors, 0.0)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    res.set_dithering_level(dither)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    let pixels: Vec<RGBA> = rgba.chunks_exact(4)
        .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
        .collect();

    let mut img = attr.new_image(pixels, w, h, 0.0)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    if background_rgba.len() == w * h * 4 {
        let bg_pixels: Vec<RGBA> = background_rgba.chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();
        let bg_img = attr.new_image(bg_pixels, w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        img.set_background(bg_img)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    }

    let (palette_out, indices) = res.remapped(&mut img)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    Ok(build_result(&palette_out, indices))
}

// ── Stateful frame encoder ──────────────────────────────────
//
// Absorbs transparency prep, quantization, bbox, edge sparse
// suppression, crop, palette trim, and canvas update into a
// single WASM call per frame, eliminating JS↔WASM round-trips.

#[wasm_bindgen]
pub struct FrameResult {
    indexed: Vec<u8>,
    palette_rgb: Vec<u8>,
    palette_rgba: Vec<u8>,
    palette_count: usize,
    transparent_index: i32,
    left: u32,
    top: u32,
    crop_width: u32,
    crop_height: u32,
    is_empty: bool,
}

#[wasm_bindgen]
impl FrameResult {
    #[wasm_bindgen(getter)]
    pub fn indexed(&self) -> Vec<u8> { self.indexed.clone() }
    #[wasm_bindgen(getter)]
    pub fn palette_rgb(&self) -> Vec<u8> { self.palette_rgb.clone() }
    #[wasm_bindgen(getter)]
    pub fn palette_rgba(&self) -> Vec<u8> { self.palette_rgba.clone() }
    #[wasm_bindgen(getter)]
    pub fn palette_count(&self) -> usize { self.palette_count }
    #[wasm_bindgen(getter)]
    pub fn transparent_index(&self) -> i32 { self.transparent_index }
    #[wasm_bindgen(getter)]
    pub fn left(&self) -> u32 { self.left }
    #[wasm_bindgen(getter)]
    pub fn top(&self) -> u32 { self.top }
    #[wasm_bindgen(getter)]
    pub fn crop_width(&self) -> u32 { self.crop_width }
    #[wasm_bindgen(getter)]
    pub fn crop_height(&self) -> u32 { self.crop_height }
    #[wasm_bindgen(getter)]
    pub fn is_empty(&self) -> bool { self.is_empty }
}

#[wasm_bindgen]
pub struct FrameEncoder {
    width: usize,
    height: usize,
    canvas: Vec<u8>,
    static_mask: Vec<u8>,
    importance_map: Vec<u8>,
}

#[wasm_bindgen]
impl FrameEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        let w = width as usize;
        let h = height as usize;
        FrameEncoder {
            width: w,
            height: h,
            canvas: vec![0u8; w * h * 4],
            static_mask: Vec::new(),
            importance_map: Vec::new(),
        }
    }

    pub fn set_static_mask(&mut self, mask: &[u8]) {
        self.static_mask = mask.to_vec();
    }

    pub fn set_importance_map(&mut self, map: &[u8]) {
        self.importance_map = map.to_vec();
    }

    /// Encode keyframe (frame 0 or scene change): full quantize, reset canvas.
    pub fn encode_keyframe(
        &mut self,
        rgba: &[u8],
        quality: u32,
        speed: i32,
        max_colors: u32,
    ) -> Result<FrameResult, JsValue> {
        let w = self.width;
        let h = self.height;
        let num_pixels = w * h;

        let mut attr = imagequant::Attributes::new();
        attr.set_quality(0, quality as u8)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        attr.set_speed(speed)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        attr.set_max_colors(max_colors)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;

        let pixels: Vec<RGBA> = rgba.chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();

        let mut img = attr.new_image(pixels, w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;

        let mut res = attr.quantize(&mut img)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        res.set_dithering_level(1.0)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;

        let (palette, indices) = res.remapped(&mut img)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;

        let palette_count = palette.len();
        let mut palette_rgba = Vec::with_capacity(palette_count * 4);
        let mut palette_rgb = Vec::with_capacity(palette_count * 3);
        for color in &palette {
            palette_rgba.push(color.r);
            palette_rgba.push(color.g);
            palette_rgba.push(color.b);
            palette_rgba.push(color.a);
            palette_rgb.push(color.r);
            palette_rgb.push(color.g);
            palette_rgb.push(color.b);
        }

        // Decode to canvas
        for i in 0..num_pixels {
            let pi = indices[i] as usize;
            let ci = i * 4;
            self.canvas[ci] = palette[pi].r;
            self.canvas[ci + 1] = palette[pi].g;
            self.canvas[ci + 2] = palette[pi].b;
            self.canvas[ci + 3] = 255;
        }

        // Trim palette
        let (trimmed_indexed, trimmed_rgb, trimmed_count, trimmed_ti) =
            trim_palette_rgb(&indices, &palette_rgb, palette_count, -1);

        Ok(FrameResult {
            indexed: trimmed_indexed,
            palette_rgb: trimmed_rgb,
            palette_rgba,
            palette_count: trimmed_count,
            transparent_index: trimmed_ti,
            left: 0,
            top: 0,
            crop_width: w as u32,
            crop_height: h as u32,
            is_empty: false,
        })
    }

    /// Encode non-keyframe: transparency prep + quantize/remap + bbox +
    /// edge sparse suppression + crop + trim palette + canvas update.
    ///
    /// If `remap_palette` is non-empty, uses fast remap path.
    /// Otherwise does full quantize with background.
    pub fn encode_frame(
        &mut self,
        rgba: &[u8],
        stale_threshold: u8,
        frame_motion: f32,
        is_quality: bool,
        next_frame: &[u8],
        remap_palette: &[u8],
        quality: u32,
        speed: i32,
        max_colors: u32,
        sparse_radius: u32,
    ) -> Result<FrameResult, JsValue> {
        let w = self.width;
        let h = self.height;
        let num_pixels = w * h;

        // ── 1. Transparency preparation ──
        let mut input = rgba.to_vec();

        // Static mask: zero alpha
        for j in 0..num_pixels {
            if self.static_mask.get(j).copied().unwrap_or(0) != 0 {
                input[j * 4 + 3] = 0;
            }
        }

        // Frame-adaptive threshold
        let frame_threshold = if !is_quality && frame_motion < 0.02 {
            (stale_threshold + 1).min(10)
        } else {
            stale_threshold
        };

        // Texture map: 3×3 neighborhood luminance range
        let mut tex_map = vec![0u8; num_pixels];
        for ty in 0..h {
            for tx in 0..w {
                let mut tmin: u16 = 765;
                let mut tmax: u16 = 0;
                let y_lo = if ty > 0 { ty - 1 } else { 0 };
                let y_hi = if ty + 1 < h { ty + 1 } else { h - 1 };
                let x_lo = if tx > 0 { tx - 1 } else { 0 };
                let x_hi = if tx + 1 < w { tx + 1 } else { w - 1 };
                for ny in y_lo..=y_hi {
                    for nx in x_lo..=x_hi {
                        let ti = (ny * w + nx) * 4;
                        let lum = input[ti] as u16 + input[ti + 1] as u16 + input[ti + 2] as u16;
                        if lum < tmin { tmin = lum; }
                        if lum > tmax { tmax = lum; }
                    }
                }
                tex_map[ty * w + tx] = ((tmax - tmin) as u32).min(255) as u8;
            }
        }

        let has_next = next_frame.len() == num_pixels * 4;

        // Stale pixel detection with texture-aware threshold + forward-look
        for j in 0..num_pixels {
            if input[j * 4 + 3] == 0 { continue; }
            let si = j * 4;
            let d = max3(
                abs_diff(input[si], self.canvas[si]),
                abs_diff(input[si + 1], self.canvas[si + 1]),
                abs_diff(input[si + 2], self.canvas[si + 2]),
            );

            let tex = tex_map[j] as f32;
            let tex_factor = 0.6 + 0.4 * (tex / 40.0).min(1.0);
            let effective_threshold = frame_threshold as f32 * tex_factor;

            if (d as f32) <= effective_threshold {
                let mut keep_forward = false;
                if has_next && tex_map[j] < 40 && d > 1 {
                    let fwd_diff = max3(
                        abs_diff(next_frame[si], self.canvas[si]),
                        abs_diff(next_frame[si + 1], self.canvas[si + 1]),
                        abs_diff(next_frame[si + 2], self.canvas[si + 2]),
                    );
                    if fwd_diff > 4 {
                        let dr = (input[si] as i32 - self.canvas[si] as i32)
                            * (next_frame[si] as i32 - self.canvas[si] as i32);
                        let dg = (input[si + 1] as i32 - self.canvas[si + 1] as i32)
                            * (next_frame[si + 1] as i32 - self.canvas[si + 1] as i32);
                        let db = (input[si + 2] as i32 - self.canvas[si + 2] as i32)
                            * (next_frame[si + 2] as i32 - self.canvas[si + 2] as i32);
                        if dr + dg + db > 0 { keep_forward = true; }
                    }
                }
                if !keep_forward {
                    input[si + 3] = 0;
                }
            }
        }

        // ── 2. Quantize or remap ──
        let use_remap = remap_palette.len() >= 8;
        let (quant_palette, quant_indices, quant_transparent_index, built_palette_rgba) = if use_remap {
            // Remap with existing palette
            let mut palette_colors: Vec<RGBA> = remap_palette.chunks_exact(4)
                .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
                .collect();
            if !palette_colors.iter().any(|c| c.a == 0) {
                palette_colors.push(RGBA { r: 0, g: 0, b: 0, a: 0 });
            }

            let attr = imagequant::Attributes::new();
            let mut res = imagequant::QuantizationResult::from_palette(&attr, &palette_colors, 0.0)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            res.set_dithering_level(1.0)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            let pixels: Vec<RGBA> = input.chunks_exact(4)
                .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
                .collect();
            let mut img = attr.new_image(pixels, w, h, 0.0)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            let bg_pixels: Vec<RGBA> = self.canvas.chunks_exact(4)
                .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
                .collect();
            let bg_img = attr.new_image(bg_pixels, w, h, 0.0)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            img.set_background(bg_img)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            let (pal, idx) = res.remapped(&mut img)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            (pal, idx, -1i32, Vec::new())
        } else {
            // Full quantize with background
            let mut attr = imagequant::Attributes::new();
            attr.set_quality(0, quality as u8)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            attr.set_speed(speed)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            attr.set_max_colors(max_colors)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            let pixels: Vec<RGBA> = input.chunks_exact(4)
                .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
                .collect();
            let mut img = attr.new_image(pixels, w, h, 0.0)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            let bg_pixels: Vec<RGBA> = self.canvas.chunks_exact(4)
                .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
                .collect();
            let bg_img = attr.new_image(bg_pixels, w, h, 0.0)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            img.set_background(bg_img)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            if self.importance_map.len() == num_pixels {
                img.set_importance_map(self.importance_map.clone())
                    .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            }

            let mut res = attr.quantize(&mut img)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;
            res.set_dithering_level(1.0)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            let (pal, idx) = res.remapped(&mut img)
                .map_err(|e| JsValue::from_str(&format!("{e}")))?;

            (pal, idx, -1i32, Vec::new())
        };

        // Find transparent index
        let mut t_idx = quant_transparent_index;
        if t_idx < 0 {
            for (i, color) in quant_palette.iter().enumerate() {
                if color.a == 0 {
                    t_idx = i as i32;
                    break;
                }
            }
        }

        // Build RGBA + RGB palette bytes
        let pal_count = quant_palette.len();
        let mut palette_rgba_out = Vec::with_capacity(pal_count * 4);
        let mut palette_rgb_full = Vec::with_capacity(pal_count * 3);
        for color in &quant_palette {
            palette_rgba_out.push(color.r);
            palette_rgba_out.push(color.g);
            palette_rgba_out.push(color.b);
            palette_rgba_out.push(color.a);
            palette_rgb_full.push(color.r);
            palette_rgb_full.push(color.g);
            palette_rgb_full.push(color.b);
        }

        // ── 3. Bounding box ──
        let mut min_x = w;
        let mut max_x: usize = 0;
        let mut min_y = h;
        let mut max_y: usize = 0;
        let mut has_opaque = false;

        for y in 0..h {
            for x in 0..w {
                if t_idx < 0 || quant_indices[y * w + x] != t_idx as u8 {
                    if x < min_x { min_x = x; }
                    if x > max_x { max_x = x; }
                    if y < min_y { min_y = y; }
                    if y > max_y { max_y = y; }
                    has_opaque = true;
                }
            }
        }

        if !has_opaque {
            // Empty frame — no visible changes
            // Still update canvas for suppressed pixels
            return Ok(FrameResult {
                indexed: vec![0],
                palette_rgb: palette_rgb_full.get(..3).unwrap_or(&[0, 0, 0]).to_vec(),
                palette_rgba: if built_palette_rgba.is_empty() { palette_rgba_out } else { built_palette_rgba },
                palette_count: 1,
                transparent_index: 0,
                left: 0,
                top: 0,
                crop_width: 1,
                crop_height: 1,
                is_empty: true,
            });
        }

        // ── 4. Edge sparse suppression ──
        let mut indices_mut = quant_indices;
        let bw = max_x - min_x + 1;
        let bh = max_y - min_y + 1;
        let margin_x = 4usize.max((bw * 2 + 4) / 5); // round(bw * 0.4)
        let margin_y = 4usize.max((bh * 2 + 4) / 5);
        let sparse_threshold = stale_threshold.saturating_add(2);
        let s_radius = sparse_radius as usize;

        for y in min_y..=max_y {
            for x in min_x..=max_x {
                let in_edge = (x - min_x < margin_x) || (max_x - x < margin_x) ||
                              (y - min_y < margin_y) || (max_y - y < margin_y);
                if !in_edge { continue; }
                let idx = y * w + x;
                if t_idx >= 0 && indices_mut[idx] == t_idx as u8 { continue; }
                let si = idx * 4;
                let d = max3(
                    abs_diff(rgba[si], self.canvas[si]),
                    abs_diff(rgba[si + 1], self.canvas[si + 1]),
                    abs_diff(rgba[si + 2], self.canvas[si + 2]),
                );
                if d > sparse_threshold { continue; }
                let mut has_neighbor = false;
                let row_start = y * w;
                let x_lo = min_x.max(x.saturating_sub(s_radius));
                let x_hi = max_x.min(x + s_radius);
                for nx in x_lo..=x_hi {
                    if nx == x { continue; }
                    if t_idx >= 0 && indices_mut[row_start + nx] == t_idx as u8 { continue; }
                    let nsi = (row_start + nx) * 4;
                    let nd = max3(
                        abs_diff(rgba[nsi], self.canvas[nsi]),
                        abs_diff(rgba[nsi + 1], self.canvas[nsi + 1]),
                        abs_diff(rgba[nsi + 2], self.canvas[nsi + 2]),
                    );
                    if nd > sparse_threshold { has_neighbor = true; break; }
                }
                if !has_neighbor && t_idx >= 0 {
                    indices_mut[idx] = t_idx as u8;
                }
            }
        }

        // Recompute bbox after suppression
        min_x = w; max_x = 0; min_y = h; max_y = 0;
        has_opaque = false;
        for y in 0..h {
            for x in 0..w {
                if t_idx < 0 || indices_mut[y * w + x] != t_idx as u8 {
                    if x < min_x { min_x = x; }
                    if x > max_x { max_x = x; }
                    if y < min_y { min_y = y; }
                    if y > max_y { max_y = y; }
                    has_opaque = true;
                }
            }
        }

        if !has_opaque {
            return Ok(FrameResult {
                indexed: vec![0],
                palette_rgb: palette_rgb_full.get(..3).unwrap_or(&[0, 0, 0]).to_vec(),
                palette_rgba: if built_palette_rgba.is_empty() { palette_rgba_out } else { built_palette_rgba },
                palette_count: 1,
                transparent_index: 0,
                left: 0,
                top: 0,
                crop_width: 1,
                crop_height: 1,
                is_empty: true,
            });
        }

        // ── 5. Update canvas (before crop) ──
        for j in 0..num_pixels {
            if t_idx < 0 || indices_mut[j] != t_idx as u8 {
                let pi = indices_mut[j] as usize;
                let ci = j * 4;
                if pi < pal_count {
                    self.canvas[ci] = quant_palette[pi].r;
                    self.canvas[ci + 1] = quant_palette[pi].g;
                    self.canvas[ci + 2] = quant_palette[pi].b;
                    self.canvas[ci + 3] = 255;
                }
            }
        }

        // ── 6. Crop + trim palette ──
        let cw = max_x - min_x + 1;
        let ch = max_y - min_y + 1;
        let mut cropped = vec![0u8; cw * ch];
        for y in 0..ch {
            let src_off = (min_y + y) * w + min_x;
            cropped[y * cw..(y + 1) * cw].copy_from_slice(&indices_mut[src_off..src_off + cw]);
        }

        let (trimmed_indexed, trimmed_rgb, trimmed_count, trimmed_ti) =
            if t_idx >= 0 {
                trim_palette_rgb(&cropped, &palette_rgb_full, pal_count, t_idx)
            } else {
                trim_palette_rgb(&cropped, &palette_rgb_full, pal_count, -1)
            };

        Ok(FrameResult {
            indexed: trimmed_indexed,
            palette_rgb: trimmed_rgb,
            palette_rgba: if built_palette_rgba.is_empty() { palette_rgba_out } else { built_palette_rgba },
            palette_count: trimmed_count,
            transparent_index: trimmed_ti,
            left: min_x as u32,
            top: min_y as u32,
            crop_width: cw as u32,
            crop_height: ch as u32,
            is_empty: false,
        })
    }

    /// Check palette fitness: p95 nearest-color distance.
    pub fn palette_p95_distance(
        &self,
        rgba: &[u8],
        palette_rgba: &[u8],
    ) -> f32 {
        let num_pixels = self.width * self.height;
        let pal_count = palette_rgba.len() / 4;
        if pal_count == 0 || rgba.len() != num_pixels * 4 { return 255.0; }

        let sample_step = 1.max(num_pixels / 2000);
        let mut dists = Vec::with_capacity(2000);
        let mut j = 0;
        while j < num_pixels {
            let si = j * 4;
            let sr = rgba[si];
            let sg = rgba[si + 1];
            let sb = rgba[si + 2];
            let mut best_dist: u16 = 765;
            for p in 0..pal_count {
                let pi = p * 4;
                let d = abs_diff(sr, palette_rgba[pi]) as u16
                    + abs_diff(sg, palette_rgba[pi + 1]) as u16
                    + abs_diff(sb, palette_rgba[pi + 2]) as u16;
                if d < best_dist { best_dist = d; }
            }
            dists.push(best_dist);
            j += sample_step;
        }
        dists.sort_unstable();
        let p95_idx = (dists.len() as f32 * 0.95) as usize;
        dists.get(p95_idx).copied().unwrap_or(0) as f32
    }
}

#[inline]
fn abs_diff(a: u8, b: u8) -> u8 {
    if a > b { a - b } else { b - a }
}

#[inline]
fn max3(a: u8, b: u8, c: u8) -> u8 {
    a.max(b).max(c)
}

/// Trim unused palette entries and remap indices.
/// Targets power-of-2 boundary when close.
fn trim_palette_rgb(
    indexed: &[u8],
    palette_rgb: &[u8],
    pal_count: usize,
    transparent_index: i32,
) -> (Vec<u8>, Vec<u8>, usize, i32) {
    let mut used = [false; 256];
    for &idx in indexed.iter() {
        used[idx as usize] = true;
    }
    if transparent_index >= 0 && (transparent_index as usize) < 256 {
        used[transparent_index as usize] = true;
    }

    let mut count = 0usize;
    for i in 0..256 { if used[i] { count += 1; } }

    if count >= pal_count {
        // Nothing to trim
        return (indexed.to_vec(), palette_rgb.to_vec(), pal_count,
                transparent_index);
    }

    // Power-of-2 eviction: if removing a few entries crosses a boundary
    let mut po2 = 2usize;
    while po2 < count { po2 <<= 1; }
    let prev_po2 = po2 >> 1;
    let overshoot = count - prev_po2;
    if overshoot > 0 && overshoot <= 1.max(count >> 4) && prev_po2 >= 4 {
        let mut freq = [0u32; 256];
        for &idx in indexed.iter() { freq[idx as usize] += 1; }
        if transparent_index >= 0 {
            freq[transparent_index as usize] = u32::MAX;
        }

        let mut used_indices: Vec<usize> = (0..256).filter(|&i| used[i]).collect();
        used_indices.sort_by_key(|&i| freq[i]);

        let mut indexed_mut = indexed.to_vec();
        let mut evicted = 0;
        for &victim in &used_indices {
            if evicted >= overshoot { break; }
            if transparent_index >= 0 && victim == transparent_index as usize { continue; }
            let vr = palette_rgb.get(victim * 3).copied().unwrap_or(0);
            let vg = palette_rgb.get(victim * 3 + 1).copied().unwrap_or(0);
            let vb = palette_rgb.get(victim * 3 + 2).copied().unwrap_or(0);
            let mut best_dist = u32::MAX;
            let mut best_idx = usize::MAX;
            for &j in &used_indices {
                if j == victim || !used[j] { continue; }
                if transparent_index >= 0 && j == transparent_index as usize { continue; }
                let d = abs_diff(palette_rgb.get(j * 3).copied().unwrap_or(0), vr) as u32
                    + abs_diff(palette_rgb.get(j * 3 + 1).copied().unwrap_or(0), vg) as u32
                    + abs_diff(palette_rgb.get(j * 3 + 2).copied().unwrap_or(0), vb) as u32;
                if d < best_dist { best_dist = d; best_idx = j; }
            }
            if best_idx < 256 {
                for px in indexed_mut.iter_mut() {
                    if *px as usize == victim { *px = best_idx as u8; }
                }
                used[victim] = false;
                count -= 1;
                evicted += 1;
            }
        }

        let mut old_to_new = [0u8; 256];
        let mut new_pal = Vec::with_capacity(count * 3);
        let mut slot = 0u8;
        for i in 0..256 {
            if !used[i] { continue; }
            old_to_new[i] = slot;
            new_pal.push(palette_rgb.get(i * 3).copied().unwrap_or(0));
            new_pal.push(palette_rgb.get(i * 3 + 1).copied().unwrap_or(0));
            new_pal.push(palette_rgb.get(i * 3 + 2).copied().unwrap_or(0));
            slot += 1;
        }
        let remapped: Vec<u8> = indexed_mut.iter().map(|&i| old_to_new[i as usize]).collect();
        let new_ti = if transparent_index >= 0 {
            old_to_new[transparent_index as usize] as i32
        } else { -1 };
        return (remapped, new_pal, count, new_ti);
    }

    // Compact
    let mut old_to_new = [0u8; 256];
    let mut new_pal = Vec::with_capacity(count * 3);
    let mut slot = 0u8;
    for i in 0..256 {
        if !used[i] { continue; }
        old_to_new[i] = slot;
        let oi = i * 3;
        new_pal.push(palette_rgb.get(oi).copied().unwrap_or(0));
        new_pal.push(palette_rgb.get(oi + 1).copied().unwrap_or(0));
        new_pal.push(palette_rgb.get(oi + 2).copied().unwrap_or(0));
        slot += 1;
    }

    let remapped: Vec<u8> = indexed.iter().map(|&i| old_to_new[i as usize]).collect();
    let new_ti = if transparent_index >= 0 {
        old_to_new[transparent_index as usize] as i32
    } else {
        -1
    };

    (remapped, new_pal, count, new_ti)
}

// ── Lanczos3 downscaling ────────────────────────────────────

fn sinc(x: f64) -> f64 {
    if x == 0.0 { return 1.0; }
    let px = PI * x;
    px.sin() / px
}

fn lanczos3(x: f64) -> f64 {
    let x = x.abs();
    if x >= 3.0 { return 0.0; }
    sinc(x) * sinc(x / 3.0)
}

struct KernelEntry {
    start: usize,
    weights: Vec<f32>,
}

fn precompute_kernel(dst_size: usize, src_size: usize) -> Vec<KernelEntry> {
    let scale = (src_size as f64) / (dst_size as f64);
    let support = (3.0 * scale).ceil() as isize;
    let mut entries = Vec::with_capacity(dst_size);

    for i in 0..dst_size {
        let center = (i as f64 + 0.5) * scale - 0.5;
        let k_min = 0isize.max((center - support as f64).floor() as isize) as usize;
        let k_max = (src_size - 1).min((center + support as f64).ceil() as usize);

        let mut weights = Vec::with_capacity(k_max - k_min + 1);
        for k in k_min..=k_max {
            weights.push(lanczos3((k as f64 - center) / scale) as f32);
        }

        entries.push(KernelEntry { start: k_min, weights });
    }

    entries
}

/// Lanczos3 downscale of an RGBA image. Two-pass separable filter
/// with precomputed kernel weights and correct non-premultiplied
/// alpha handling.
#[wasm_bindgen]
pub fn downsample_lanczos3(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Vec<u8> {
    let sw = src_w as usize;
    let sh = src_h as usize;
    let dw = dst_w as usize;
    let dh = dst_h as usize;

    if dw >= sw && dh >= sh {
        return src.to_vec();
    }

    let x_kernel = precompute_kernel(dw, sw);
    let y_kernel = precompute_kernel(dh, sh);

    // Horizontal pass: sw×sh → dw×sh
    let mut tmp = vec![0.0f32; dw * sh * 4];

    for y in 0..sh {
        let row_offset = y * sw * 4;
        let dst_row = y * dw * 4;
        for (x, ke) in x_kernel.iter().enumerate() {
            let mut r = 0.0f32;
            let mut g = 0.0f32;
            let mut b = 0.0f32;
            let mut a = 0.0f32;
            let mut w_sum = 0.0f32;

            for (j, &w) in ke.weights.iter().enumerate() {
                let si = row_offset + (ke.start + j) * 4;
                let sa = src[si + 3] as f32 * (1.0 / 255.0);
                r += src[si] as f32 * sa * w;
                g += src[si + 1] as f32 * sa * w;
                b += src[si + 2] as f32 * sa * w;
                a += sa * w;
                w_sum += w;
            }

            let di = dst_row + x * 4;
            if a > 0.001 {
                let inv_a = 1.0 / a;
                tmp[di] = r * inv_a;
                tmp[di + 1] = g * inv_a;
                tmp[di + 2] = b * inv_a;
                tmp[di + 3] = a / w_sum * 255.0;
            }
        }
    }

    // Vertical pass: dw×sh → dw×dh
    let mut dst = vec![0u8; dw * dh * 4];
    let stride = dw * 4;

    for y in 0..dh {
        let ke = &y_kernel[y];
        let dst_row = y * stride;
        for x in 0..dw {
            let x4 = x * 4;
            let mut r = 0.0f32;
            let mut g = 0.0f32;
            let mut b = 0.0f32;
            let mut a = 0.0f32;
            let mut w_sum = 0.0f32;

            for (j, &w) in ke.weights.iter().enumerate() {
                let si = (ke.start + j) * stride + x4;
                let sa = tmp[si + 3] * (1.0 / 255.0);
                r += tmp[si] * sa * w;
                g += tmp[si + 1] * sa * w;
                b += tmp[si + 2] * sa * w;
                a += sa * w;
                w_sum += w;
            }

            let di = dst_row + x4;
            if a > 0.001 {
                let inv_a = 1.0 / a;
                dst[di] = (r * inv_a + 0.5).clamp(0.0, 255.0) as u8;
                dst[di + 1] = (g * inv_a + 0.5).clamp(0.0, 255.0) as u8;
                dst[di + 2] = (b * inv_a + 0.5).clamp(0.0, 255.0) as u8;
                dst[di + 3] = (a / w_sum * 255.0 + 0.5).clamp(0.0, 255.0) as u8;
            }
        }
    }

    dst
}
