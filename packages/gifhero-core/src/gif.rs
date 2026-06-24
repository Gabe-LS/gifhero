pub struct GifFrame {
    pub indexed: Vec<u8>,
    pub palette: Vec<u8>,
    pub palette_count: usize,
    pub transparent_index: i32,
    pub delay: u16,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub disposal: u8,
}

pub fn write_gif(
    width: u16,
    height: u16,
    frames: &[GifFrame],
    lzw_data: &[Vec<u8>],
) -> Vec<u8> {
    let mut buf: Vec<u8> = Vec::new();

    buf.extend_from_slice(b"GIF89a");

    write_u16_le(&mut buf, width);
    write_u16_le(&mut buf, height);
    buf.push(0x00);
    buf.push(0);
    buf.push(0);

    buf.push(0x21);
    buf.push(0xFF);
    buf.push(11);
    buf.extend_from_slice(b"NETSCAPE2.0");
    buf.push(3);
    buf.push(1);
    write_u16_le(&mut buf, 0);
    buf.push(0);

    for (i, frame) in frames.iter().enumerate() {
        let disposal = frame.disposal;
        let has_transparency = frame.transparent_index >= 0;
        let packed_gce = (disposal << 2) | if has_transparency { 1 } else { 0 };
        let delay_cs = ((frame.delay as f64) / 10.0).round() as u16;

        buf.push(0x21);
        buf.push(0xF9);
        buf.push(4);
        buf.push(packed_gce);
        write_u16_le(&mut buf, delay_cs);
        buf.push(if has_transparency {
            frame.transparent_index as u8
        } else {
            0
        });
        buf.push(0);

        let min_entries = if has_transparency {
            frame.transparent_index as usize + 1
        } else {
            0
        };
        let num_colors = frame.palette_count.max(min_entries);
        let padded_size = pad_to_pow2(num_colors);
        let bits = log2_exact(padded_size);
        let color_table_bits = bits - 1;
        let min_code_size = bits.max(2) as u8;

        buf.push(0x2C);
        write_u16_le(&mut buf, frame.x);
        write_u16_le(&mut buf, frame.y);
        write_u16_le(&mut buf, frame.width);
        write_u16_le(&mut buf, frame.height);
        buf.push(0x80 | color_table_bits as u8);

        for j in 0..padded_size {
            if j < frame.palette_count {
                buf.push(frame.palette[j * 4]);
                buf.push(frame.palette[j * 4 + 1]);
                buf.push(frame.palette[j * 4 + 2]);
            } else {
                buf.push(0);
                buf.push(0);
                buf.push(0);
            }
        }

        buf.push(min_code_size);

        write_sub_blocks(&mut buf, &lzw_data[i]);
        buf.push(0);
    }

    buf.push(0x3B);
    buf
}

pub fn compute_min_code_size(palette_count: usize, transparent_index: i32) -> u8 {
    let min_entries = if transparent_index >= 0 {
        transparent_index as usize + 1
    } else {
        0
    };
    let num_colors = palette_count.max(min_entries);
    let padded_size = pad_to_pow2(num_colors);
    let bits = log2_exact(padded_size);
    bits.max(2) as u8
}

fn write_u16_le(buf: &mut Vec<u8>, n: u16) {
    buf.push((n & 0xff) as u8);
    buf.push((n >> 8) as u8);
}

fn write_sub_blocks(buf: &mut Vec<u8>, data: &[u8]) {
    let mut offset = 0;
    while offset < data.len() {
        let block_size = 255.min(data.len() - offset);
        buf.push(block_size as u8);
        buf.extend_from_slice(&data[offset..offset + block_size]);
        offset += block_size;
    }
}

fn pad_to_pow2(n: usize) -> usize {
    for &size in &[4, 8, 16, 32, 64, 128, 256] {
        if size >= n {
            return size;
        }
    }
    256
}

fn log2_exact(n: usize) -> usize {
    match n {
        4 => 2,
        8 => 3,
        16 => 4,
        32 => 5,
        64 => 6,
        128 => 7,
        256 => 8,
        _ => {
            let mut bits = 1;
            while (1 << bits) < n {
                bits += 1;
            }
            bits
        }
    }
}
