use wasm_bindgen::prelude::*;
use imagequant::RGBA;

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
