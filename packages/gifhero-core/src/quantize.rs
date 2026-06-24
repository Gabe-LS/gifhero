use imagequant::RGBA;

pub struct QuantResult {
    pub palette: Vec<u8>,
    pub indexed: Vec<u8>,
    pub palette_count: usize,
    pub transparent_index: i32,
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
    QuantResult { palette: palette_bytes, indexed: indices, palette_count, transparent_index }
}

pub fn quantize_simple(
    rgba: &[u8], width: usize, height: usize,
    quality_min: u8, quality_max: u8, speed: i32, max_colors: u32,
) -> QuantResult {
    do_quantize(rgba, width, height, quality_min, quality_max, speed, max_colors,
        &[], &[], 1.0)
}

pub fn quantize_with_background(
    rgba: &[u8], width: usize, height: usize,
    background: &[u8], importance_map: &[u8],
    quality_min: u8, quality_max: u8, speed: i32, max_colors: u32,
) -> QuantResult {
    do_quantize(rgba, width, height, quality_min, quality_max, speed, max_colors,
        background, importance_map, 1.0)
}

fn do_quantize(
    rgba: &[u8], width: usize, height: usize,
    quality_min: u8, quality_max: u8, speed: i32, max_colors: u32,
    background_rgba: &[u8], importance_map: &[u8], dither: f32,
) -> QuantResult {
    let mut attr = imagequant::Attributes::new();
    attr.set_quality(quality_min, quality_max).unwrap();
    attr.set_speed(speed).unwrap();
    attr.set_max_colors(max_colors).unwrap();

    let pixels: Vec<RGBA> = rgba.chunks_exact(4)
        .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
        .collect();

    let mut img = attr.new_image(pixels, width, height, 0.0).unwrap();

    if background_rgba.len() == width * height * 4 {
        let bg_pixels: Vec<RGBA> = background_rgba.chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();
        let bg_img = attr.new_image(bg_pixels, width, height, 0.0).unwrap();
        img.set_background(bg_img).unwrap();
    }

    if importance_map.len() == width * height {
        img.set_importance_map(importance_map.to_vec()).unwrap();
    }

    let mut res = attr.quantize(&mut img).unwrap();
    res.set_dithering_level(dither).unwrap();

    let (palette, indices) = res.remapped(&mut img).unwrap();
    build_result(&palette, indices)
}

pub fn build_shared_palette(
    frames: &[&[u8]], width: usize, height: usize,
    quality_min: u8, quality_max: u8, speed: i32, max_colors: u32,
) -> Vec<u8> {
    let mut attr = imagequant::Attributes::new();
    attr.set_quality(quality_min, quality_max).unwrap();
    attr.set_speed(speed).unwrap();
    attr.set_max_colors(max_colors).unwrap();

    let mut hist = imagequant::Histogram::new(&attr);

    for frame in frames {
        let pixels: Vec<RGBA> = frame.chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();
        let mut img = attr.new_image(pixels, width, height, 0.0).unwrap();
        hist.add_image(&attr, &mut img).unwrap();
    }

    let mut res = hist.quantize(&attr).unwrap();
    let palette = res.palette_vec();
    let mut palette_bytes = Vec::with_capacity(palette.len() * 4);
    for color in &palette {
        palette_bytes.push(color.r);
        palette_bytes.push(color.g);
        palette_bytes.push(color.b);
        palette_bytes.push(color.a);
    }
    palette_bytes
}

pub fn remap_with_palette(
    rgba: &[u8], width: usize, height: usize,
    palette: &[u8], background: &[u8], dither: f32,
) -> QuantResult {
    let mut palette_colors: Vec<RGBA> = palette.chunks_exact(4)
        .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
        .collect();

    if !palette_colors.iter().any(|c| c.a == 0) {
        palette_colors.push(RGBA { r: 0, g: 0, b: 0, a: 0 });
    }

    let attr = imagequant::Attributes::new();

    let mut res = imagequant::QuantizationResult::from_palette(&attr, &palette_colors, 0.0).unwrap();
    res.set_dithering_level(dither).unwrap();

    let pixels: Vec<RGBA> = rgba.chunks_exact(4)
        .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
        .collect();

    let mut img = attr.new_image(pixels, width, height, 0.0).unwrap();

    if background.len() == width * height * 4 {
        let bg_pixels: Vec<RGBA> = background.chunks_exact(4)
            .map(|c| RGBA { r: c[0], g: c[1], b: c[2], a: c[3] })
            .collect();
        let bg_img = attr.new_image(bg_pixels, width, height, 0.0).unwrap();
        img.set_background(bg_img).unwrap();
    }

    let (palette_out, indices) = res.remapped(&mut img).unwrap();
    build_result(&palette_out, indices)
}
