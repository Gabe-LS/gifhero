pub struct BBox {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

pub fn find_changed_bbox(
    indexed: &[u8], width: usize, height: usize,
    transparent_index: i32,
) -> Option<BBox> {
    let mut min_x = width;
    let mut max_x: isize = -1;
    let mut min_y = height;
    let mut max_y: isize = -1;

    for y in 0..height {
        for x in 0..width {
            let idx = indexed[y * width + x];
            if idx as i32 != transparent_index {
                if x < min_x { min_x = x; }
                if x as isize > max_x { max_x = x as isize; }
                if y < min_y { min_y = y; }
                if y as isize > max_y { max_y = y as isize; }
            }
        }
    }

    if max_x < 0 {
        None
    } else {
        Some(BBox {
            x: min_x,
            y: min_y,
            w: (max_x as usize) - min_x + 1,
            h: (max_y as usize) - min_y + 1,
        })
    }
}

pub fn crop_indexed(
    indexed: &[u8], width: usize,
    bbox: &BBox,
) -> Vec<u8> {
    let mut out = vec![0u8; bbox.w * bbox.h];
    for y in 0..bbox.h {
        let src_off = (bbox.y + y) * width + bbox.x;
        let dst_off = y * bbox.w;
        out[dst_off..dst_off + bbox.w].copy_from_slice(&indexed[src_off..src_off + bbox.w]);
    }
    out
}

pub fn decode_frame_to_canvas(
    canvas: &mut [u8],
    indexed: &[u8],
    palette: &[u8],
    width: usize,
    height: usize,
) {
    let np = width * height;
    for i in 0..np {
        let pi = indexed[i] as usize * 3;
        let ci = i * 4;
        canvas[ci] = palette[pi];
        canvas[ci + 1] = palette[pi + 1];
        canvas[ci + 2] = palette[pi + 2];
        canvas[ci + 3] = 255;
    }
}

pub fn decode_frame_to_canvas_rgba(
    canvas: &mut [u8],
    indexed: &[u8],
    palette_rgba: &[u8],
    width: usize,
    height: usize,
) {
    let np = width * height;
    for i in 0..np {
        let pi = indexed[i] as usize * 4;
        let ci = i * 4;
        canvas[ci] = palette_rgba[pi];
        canvas[ci + 1] = palette_rgba[pi + 1];
        canvas[ci + 2] = palette_rgba[pi + 2];
        canvas[ci + 3] = palette_rgba[pi + 3];
    }
}

pub fn composite_onto_canvas(
    canvas: &mut [u8],
    indexed: &[u8],
    palette: &[u8],
    transparent_index: i32,
    offset_x: usize,
    offset_y: usize,
    crop_w: usize,
    crop_h: usize,
    frame_w: usize,
) {
    for y in 0..crop_h {
        for x in 0..crop_w {
            let idx = indexed[y * crop_w + x];
            if idx as i32 == transparent_index { continue; }
            let pi = idx as usize * 3;
            let ci = ((offset_y + y) * frame_w + (offset_x + x)) * 4;
            canvas[ci] = palette[pi];
            canvas[ci + 1] = palette[pi + 1];
            canvas[ci + 2] = palette[pi + 2];
            canvas[ci + 3] = 255;
        }
    }
}

pub struct TrimResult {
    pub palette: Vec<u8>,
    pub indexed: Vec<u8>,
    pub palette_count: usize,
    pub transparent_index: i32,
}

pub fn trim_palette(
    palette: &[u8],
    indexed: &[u8],
    transparent_index: i32,
) -> TrimResult {
    let mut used = [0u8; 256];
    for &idx in indexed {
        used[idx as usize] = 1;
    }
    if transparent_index >= 0 {
        used[transparent_index as usize] = 1;
    }

    let mut count = 0usize;
    for i in 0..256 {
        if used[i] != 0 { count += 1; }
    }

    let orig_colors = palette.len() / 3;
    if count >= orig_colors {
        return TrimResult {
            palette: palette.to_vec(),
            indexed: indexed.to_vec(),
            palette_count: orig_colors,
            transparent_index,
        };
    }

    let mut po2 = 2usize;
    while po2 < count { po2 <<= 1; }
    let prev_po2 = po2 >> 1;
    let overshoot = count as isize - prev_po2 as isize;
    if overshoot > 0 && overshoot <= (count >> 4).max(1) as isize && prev_po2 >= 4 {
        let mut freq = [0u32; 256];
        for &idx in indexed {
            freq[idx as usize] += 1;
        }
        if transparent_index >= 0 {
            freq[transparent_index as usize] = 0xFFFF_FFFF;
        }

        let mut used_indices: Vec<usize> = (0..256).filter(|&i| used[i] != 0).collect();
        used_indices.sort_by_key(|&i| freq[i]);

        let mut indexed_mut = indexed.to_vec();
        for e in 0..overshoot as usize {
            let victim = used_indices[e];
            if victim as i32 == transparent_index { continue; }
            let vr = palette[victim * 3] as i32;
            let vg = palette[victim * 3 + 1] as i32;
            let vb = palette[victim * 3 + 2] as i32;
            let mut best_dist = i32::MAX;
            let mut best_idx: isize = -1;
            for &j in &used_indices {
                if j == victim || used[j] == 0 { continue; }
                if j as i32 == transparent_index { continue; }
                let d = (palette[j * 3] as i32 - vr).abs()
                    + (palette[j * 3 + 1] as i32 - vg).abs()
                    + (palette[j * 3 + 2] as i32 - vb).abs();
                if d < best_dist { best_dist = d; best_idx = j as isize; }
            }
            if best_idx >= 0 {
                for px in indexed_mut.iter_mut() {
                    if *px as usize == victim { *px = best_idx as u8; }
                }
                used[victim] = 0;
                count -= 1;
            }
        }

        let mut old_to_new = [0u8; 256];
        let mut new_pal = Vec::with_capacity(count * 3);
        let mut slot = 0u8;
        for i in 0..256 {
            if used[i] == 0 { continue; }
            old_to_new[i] = slot;
            let oi = i * 3;
            if oi + 2 < palette.len() {
                new_pal.push(palette[oi]);
                new_pal.push(palette[oi + 1]);
                new_pal.push(palette[oi + 2]);
            } else {
                new_pal.extend_from_slice(&[0, 0, 0]);
            }
            slot += 1;
        }

        let remapped: Vec<u8> = indexed_mut.iter().map(|&i| old_to_new[i as usize]).collect();
        let new_ti = if transparent_index >= 0 {
            old_to_new[transparent_index as usize] as i32
        } else {
            -1
        };

        return TrimResult {
            palette: new_pal,
            indexed: remapped,
            palette_count: slot as usize,
            transparent_index: new_ti,
        };
    }

    let mut old_to_new = [0u8; 256];
    let mut new_pal = Vec::with_capacity(count * 3);
    let mut slot = 0u8;
    for i in 0..256 {
        if used[i] == 0 { continue; }
        old_to_new[i] = slot;
        let oi = i * 3;
        if oi + 2 < palette.len() {
            new_pal.push(palette[oi]);
            new_pal.push(palette[oi + 1]);
            new_pal.push(palette[oi + 2]);
        } else {
            new_pal.extend_from_slice(&[0, 0, 0]);
        }
        slot += 1;
    }

    let remapped: Vec<u8> = indexed.iter().map(|&i| old_to_new[i as usize]).collect();
    let new_ti = if transparent_index >= 0 {
        old_to_new[transparent_index as usize] as i32
    } else {
        -1
    };

    TrimResult {
        palette: new_pal,
        indexed: remapped,
        palette_count: slot as usize,
        transparent_index: new_ti,
    }
}

pub fn rgba_to_rgb_palette(rgba: &[u8], count: usize) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(count * 3);
    for i in 0..count {
        rgb.push(rgba[i * 4]);
        rgb.push(rgba[i * 4 + 1]);
        rgb.push(rgba[i * 4 + 2]);
    }
    rgb
}
