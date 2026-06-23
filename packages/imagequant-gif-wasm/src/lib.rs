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

fn do_quantize(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality_min: u32,
    quality_max: u32,
    speed: i32,
    max_colors: u32,
    background_rgba: &[u8],
    importance_map: &[u8],
    dither: f32,
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

    let pixels: Vec<RGBA> = rgba
        .chunks_exact(4)
        .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
        .collect();

    let mut img = attr
        .new_image(pixels, w, h, 0.0)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    if background_rgba.len() == w * h * 4 {
        let bg_pixels: Vec<RGBA> = background_rgba
            .chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();
        let bg_img = attr
            .new_image(bg_pixels, w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
        img.set_background(bg_img)
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    }

    if importance_map.len() == w * h {
        img.set_importance_map(importance_map.to_vec())
            .map_err(|e| JsValue::from_str(&format!("{e}")))?;
    }

    let mut res = attr
        .quantize(&mut img)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    res.set_dithering_level(dither)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

    let (palette, indices) = res
        .remapped(&mut img)
        .map_err(|e| JsValue::from_str(&format!("{e}")))?;

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

    Ok(QuantResult {
        palette: palette_bytes,
        indices,
        palette_count,
        transparent_index,
    })
}

#[wasm_bindgen]
pub fn quantize_with_background(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality_min: u32,
    quality_max: u32,
    speed: i32,
    max_colors: u32,
    background_rgba: &[u8],
    importance_map: &[u8],
) -> Result<QuantResult, JsValue> {
    do_quantize(
        rgba, width, height, quality_min, quality_max, speed, max_colors,
        background_rgba, importance_map, 1.0,
    )
}

#[wasm_bindgen]
pub fn quantize_simple(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality_min: u32,
    quality_max: u32,
    speed: i32,
    max_colors: u32,
) -> Result<QuantResult, JsValue> {
    do_quantize(
        rgba, width, height, quality_min, quality_max, speed, max_colors,
        &[], &[], 1.0,
    )
}

#[wasm_bindgen]
pub fn quantize_no_dither(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality_min: u32,
    quality_max: u32,
    speed: i32,
    max_colors: u32,
    background_rgba: &[u8],
    importance_map: &[u8],
) -> Result<QuantResult, JsValue> {
    do_quantize(
        rgba, width, height, quality_min, quality_max, speed, max_colors,
        background_rgba, importance_map, 0.0,
    )
}
