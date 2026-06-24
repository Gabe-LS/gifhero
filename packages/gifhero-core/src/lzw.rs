use std::collections::HashMap;

const MAX_CODE: u16 = 4095;
const DEFER_WINDOW: usize = 256;

pub fn lzw_encode(indexed: &[u8], min_code_size: u8) -> Vec<u8> {
    let clear_code: u16 = 1 << min_code_size;
    let eoi_code: u16 = clear_code + 1;

    let mut output: Vec<u8> = Vec::new();
    let mut cur_byte: u32 = 0;
    let mut cur_bits: u32 = 0;

    let mut dict: HashMap<u32, u16> = HashMap::new();
    let mut next_code: u16;
    let mut code_size: u8;

    macro_rules! emit {
        ($code:expr, $size:expr) => {{
            cur_byte |= ($code as u32) << cur_bits;
            cur_bits += $size as u32;
            while cur_bits >= 8 {
                output.push((cur_byte & 0xff) as u8);
                cur_byte >>= 8;
                cur_bits -= 8;
            }
        }};
    }

    macro_rules! reset {
        () => {{
            dict.clear();
            next_code = eoi_code + 1;
            code_size = min_code_size + 1;
        }};
    }

    reset!();
    emit!(clear_code, code_size);

    if indexed.is_empty() {
        emit!(eoi_code, code_size);
        if cur_bits > 0 {
            output.push((cur_byte & 0xff) as u8);
        }
        return output;
    }

    let mut prefix: u16 = indexed[0] as u16;
    let mut deferring = false;
    let mut defer_start: usize = 0;
    let mut defer_pixels: usize = 0;

    for i in 1..indexed.len() {
        let suffix = indexed[i];
        let key = (prefix as u32) << 8 | suffix as u32;

        if let Some(&code) = dict.get(&key) {
            prefix = code;
        } else {
            emit!(prefix, code_size);

            if next_code <= MAX_CODE {
                if next_code >= 1 << code_size && code_size < 12 {
                    code_size += 1;
                }
                dict.insert(key, next_code);
                next_code += 1;
            } else if !deferring {
                deferring = true;
                defer_start = output.len();
                defer_pixels = 0;
            }

            if deferring {
                defer_pixels += 1;
                if defer_pixels >= DEFER_WINDOW {
                    let bytes_emitted = output.len() - defer_start;
                    let bits_per_pixel = (bytes_emitted as f64 * 8.0) / defer_pixels as f64;
                    if bits_per_pixel > 11.0 {
                        emit!(clear_code, code_size);
                        reset!();
                        deferring = false;
                    } else {
                        defer_start = output.len();
                        defer_pixels = 0;
                    }
                }
            }

            prefix = suffix as u16;
        }
    }

    emit!(prefix, code_size);
    emit!(eoi_code, code_size);
    if cur_bits > 0 {
        output.push((cur_byte & 0xff) as u8);
    }

    output
}

pub fn lzw_encode_lossy(
    indexed: &[u8],
    min_code_size: u8,
    palette: &[u8],
    palette_count: usize,
    lossiness: u8,
    transparent_index: i32,
) -> Vec<u8> {
    if lossiness == 0 {
        return lzw_encode(indexed, min_code_size);
    }

    let dist_table = build_dist_table(palette, palette_count);

    let clear_code: u16 = 1 << min_code_size;
    let eoi_code: u16 = clear_code + 1;

    let mut output: Vec<u8> = Vec::new();
    let mut cur_byte: u32 = 0;
    let mut cur_bits: u32 = 0;

    let mut dict: HashMap<u32, u16> = HashMap::new();
    let mut next_code: u16;
    let mut code_size: u8;

    macro_rules! emit {
        ($code:expr, $size:expr) => {{
            cur_byte |= ($code as u32) << cur_bits;
            cur_bits += $size as u32;
            while cur_bits >= 8 {
                output.push((cur_byte & 0xff) as u8);
                cur_byte >>= 8;
                cur_bits -= 8;
            }
        }};
    }

    macro_rules! reset {
        () => {{
            dict.clear();
            next_code = eoi_code + 1;
            code_size = min_code_size + 1;
        }};
    }

    reset!();
    emit!(clear_code, code_size);

    if indexed.is_empty() {
        emit!(eoi_code, code_size);
        if cur_bits > 0 {
            output.push((cur_byte & 0xff) as u8);
        }
        return output;
    }

    let mut prefix: u16 = indexed[0] as u16;
    let mut deferring = false;
    let mut defer_start: usize = 0;
    let mut defer_pixels: usize = 0;

    let loss = lossiness as u8;
    let trans_idx = transparent_index;

    for i in 1..indexed.len() {
        let suffix = indexed[i];
        let exact_key = (prefix as u32) << 8 | suffix as u32;

        if let Some(&code) = dict.get(&exact_key) {
            prefix = code;
        } else if suffix as i32 != trans_idx {
            let mut best_key: i64 = -1;
            let mut best_dist: u8 = loss + 1;
            let base = suffix as usize * 256;
            for alt in 0..palette_count {
                if alt == suffix as usize || alt as i32 == trans_idx {
                    continue;
                }
                let d = dist_table[base + alt];
                if d <= loss && d < best_dist {
                    let alt_key = (prefix as u32) << 8 | alt as u32;
                    if dict.contains_key(&alt_key) {
                        best_key = alt_key as i64;
                        best_dist = d;
                    }
                }
            }

            if best_key >= 0 {
                prefix = *dict.get(&(best_key as u32)).unwrap();
            } else {
                emit!(prefix, code_size);

                if next_code <= MAX_CODE {
                    if next_code >= 1 << code_size && code_size < 12 {
                        code_size += 1;
                    }
                    dict.insert(exact_key, next_code);
                    next_code += 1;
                } else if !deferring {
                    deferring = true;
                    defer_start = output.len();
                    defer_pixels = 0;
                }

                if deferring {
                    defer_pixels += 1;
                    if defer_pixels >= DEFER_WINDOW {
                        let bytes_emitted = output.len() - defer_start;
                        let bpp = (bytes_emitted as f64 * 8.0) / defer_pixels as f64;
                        if bpp > 11.0 {
                            emit!(clear_code, code_size);
                            reset!();
                            deferring = false;
                        } else {
                            defer_start = output.len();
                            defer_pixels = 0;
                        }
                    }
                }

                prefix = suffix as u16;
            }
        } else {
            emit!(prefix, code_size);

            if next_code <= MAX_CODE {
                if next_code >= 1 << code_size && code_size < 12 {
                    code_size += 1;
                }
                dict.insert(exact_key, next_code);
                next_code += 1;
            } else if !deferring {
                deferring = true;
                defer_start = output.len();
                defer_pixels = 0;
            }

            if deferring {
                defer_pixels += 1;
                if defer_pixels >= DEFER_WINDOW {
                    let bytes_emitted = output.len() - defer_start;
                    let bpp = (bytes_emitted as f64 * 8.0) / defer_pixels as f64;
                    if bpp > 11.0 {
                        emit!(clear_code, code_size);
                        reset!();
                        deferring = false;
                    } else {
                        defer_start = output.len();
                        defer_pixels = 0;
                    }
                }
            }

            prefix = suffix as u16;
        }
    }

    emit!(prefix, code_size);
    emit!(eoi_code, code_size);
    if cur_bits > 0 {
        output.push((cur_byte & 0xff) as u8);
    }

    output
}

fn build_dist_table(palette: &[u8], palette_count: usize) -> Vec<u8> {
    let mut dist = vec![0u8; 256 * 256];
    for i in 0..palette_count {
        let ri = palette[i * 3] as i16;
        let gi = palette[i * 3 + 1] as i16;
        let bi = palette[i * 3 + 2] as i16;
        for j in (i + 1)..palette_count {
            let d = (ri - palette[j * 3] as i16)
                .abs()
                .max((gi - palette[j * 3 + 1] as i16).abs())
                .max((bi - palette[j * 3 + 2] as i16).abs()) as u8;
            dist[i * 256 + j] = d;
            dist[j * 256 + i] = d;
        }
    }
    dist
}
