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
