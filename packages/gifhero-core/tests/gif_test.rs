use gifhero_core::gif::{write_gif, GifFrame, compute_min_code_size};
use gifhero_core::lzw::{lzw_encode, lzw_encode_lossy};

#[test]
fn test_lzw_basic_solid() {
    let pixels: Vec<u8> = vec![0; 16];
    let encoded = lzw_encode(&pixels, 2);
    assert!(!encoded.is_empty());
    assert!(encoded.len() < pixels.len());
}

#[test]
fn test_lzw_empty() {
    let encoded = lzw_encode(&[], 2);
    assert!(!encoded.is_empty());
}

#[test]
fn test_lzw_all_same_value() {
    let pixels = vec![1u8; 1000];
    let encoded = lzw_encode(&pixels, 2);
    assert!(encoded.len() < 100, "solid fill should compress very well");
}

#[test]
fn test_lzw_gradient() {
    let mut pixels = Vec::with_capacity(256);
    for i in 0..256 {
        pixels.push(i as u8);
    }
    let encoded = lzw_encode(&pixels, 8);
    assert!(!encoded.is_empty());
}

#[test]
fn test_lzw_deferred_clear() {
    let mut pixels = Vec::with_capacity(10000);
    for i in 0..10000 {
        pixels.push((i % 64) as u8);
    }
    let encoded = lzw_encode(&pixels, 7);
    assert!(!encoded.is_empty());
    assert!(
        encoded.len() < pixels.len(),
        "repetitive data should compress"
    );
}

#[test]
fn test_lzw_lossy_same_as_lossless_at_zero() {
    let pixels = vec![0u8, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
    let mut palette = vec![0u8; 4 * 4];
    palette[0] = 255; palette[1] = 0; palette[2] = 0; palette[3] = 255;
    palette[4] = 0; palette[5] = 255; palette[6] = 0; palette[7] = 255;
    palette[8] = 0; palette[9] = 0; palette[10] = 255; palette[11] = 255;
    palette[12] = 128; palette[13] = 128; palette[14] = 128; palette[15] = 255;

    let lossless = lzw_encode(&pixels, 2);
    let lossy = lzw_encode_lossy(&pixels, 2, &palette, 4, 0, -1);
    assert_eq!(lossless, lossy, "lossiness=0 should produce identical output");
}

#[test]
fn test_lzw_lossy_smaller_than_lossless() {
    let mut pixels = Vec::with_capacity(1000);
    for i in 0..1000 {
        pixels.push((i % 16) as u8);
    }

    let mut palette = vec![0u8; 16 * 4];
    for i in 0..16 {
        palette[i * 4] = (i * 16) as u8;
        palette[i * 4 + 1] = (i * 16) as u8;
        palette[i * 4 + 2] = (i * 16) as u8;
        palette[i * 4 + 3] = 255;
    }

    let lossless = lzw_encode(&pixels, 4);
    let lossy = lzw_encode_lossy(&pixels, 4, &palette, 16, 20, -1);
    assert!(
        lossy.len() <= lossless.len(),
        "lossy ({}) should be <= lossless ({}) for similar palette entries",
        lossy.len(),
        lossless.len()
    );
}

#[test]
fn test_gif_two_frame_roundtrip() {
    let w: u16 = 4;
    let h: u16 = 4;
    let pixels = w as usize * h as usize;

    let mut palette = vec![0u8; 4 * 4];
    palette[0] = 255; palette[1] = 0; palette[2] = 0; palette[3] = 255;
    palette[4] = 0; palette[5] = 0; palette[6] = 255; palette[7] = 255;
    palette[8] = 0; palette[9] = 255; palette[10] = 0; palette[11] = 255;
    palette[12] = 0; palette[13] = 0; palette[14] = 0; palette[15] = 0;

    let frame1_indexed = vec![0u8; pixels];
    let frame2_indexed = vec![1u8; pixels];

    let min_code_size = compute_min_code_size(4, -1);
    assert_eq!(min_code_size, 2);

    let lzw1 = lzw_encode(&frame1_indexed, min_code_size);
    let lzw2 = lzw_encode(&frame2_indexed, min_code_size);

    let frames = vec![
        GifFrame {
            indexed: frame1_indexed,
            palette: palette.clone(),
            palette_count: 4,
            transparent_index: -1,
            delay: 100,
            x: 0,
            y: 0,
            width: w,
            height: h,
            disposal: 1,
        },
        GifFrame {
            indexed: frame2_indexed,
            palette: palette.clone(),
            palette_count: 4,
            transparent_index: -1,
            delay: 100,
            x: 0,
            y: 0,
            width: w,
            height: h,
            disposal: 1,
        },
    ];

    let lzw_data = vec![lzw1, lzw2];
    let gif = write_gif(w, h, &frames, &lzw_data);

    assert_eq!(&gif[0..6], b"GIF89a", "header");
    assert_eq!(*gif.last().unwrap(), 0x3B, "trailer");
    assert!(gif.len() < 200, "tiny GIF should be < 200 bytes, got {}", gif.len());

    assert_eq!(gif[6], w as u8);
    assert_eq!(gif[7], 0);
    assert_eq!(gif[8], h as u8);
    assert_eq!(gif[9], 0);
}

#[test]
fn test_gif_with_transparency() {
    let w: u16 = 2;
    let h: u16 = 2;

    let mut palette = vec![0u8; 5 * 4];
    palette[0] = 255; palette[1] = 0; palette[2] = 0; palette[3] = 255;
    palette[4] = 0; palette[5] = 255; palette[6] = 0; palette[7] = 255;
    palette[8] = 0; palette[9] = 0; palette[10] = 255; palette[11] = 255;
    palette[12] = 255; palette[13] = 255; palette[14] = 0; palette[15] = 255;
    palette[16] = 0; palette[17] = 0; palette[18] = 0; palette[19] = 0;

    let indexed = vec![0u8, 4, 1, 4];

    let min_code_size = compute_min_code_size(5, 4);
    assert_eq!(min_code_size, 3);

    let lzw = lzw_encode(&indexed, min_code_size);

    let frames = vec![GifFrame {
        indexed,
        palette,
        palette_count: 5,
        transparent_index: 4,
        delay: 50,
        x: 0,
        y: 0,
        width: w,
        height: h,
        disposal: 1,
    }];

    let lzw_data = vec![lzw];
    let gif = write_gif(w, h, &frames, &lzw_data);

    assert_eq!(&gif[0..6], b"GIF89a");
    assert_eq!(*gif.last().unwrap(), 0x3B);

    let gce_pos = gif.windows(2).position(|w| w == [0x21, 0xF9]).unwrap();
    let packed = gif[gce_pos + 3];
    assert_eq!(packed & 1, 1, "transparency flag should be set");
    let trans_idx = gif[gce_pos + 6];
    assert_eq!(trans_idx, 4, "transparent index in GCE");
}

#[test]
fn test_gif_delay_conversion() {
    let w: u16 = 1;
    let h: u16 = 1;

    let palette = vec![255u8, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255];
    let indexed = vec![0u8];

    let min_code_size = compute_min_code_size(4, -1);
    let lzw = lzw_encode(&indexed, min_code_size);

    let frames = vec![GifFrame {
        indexed,
        palette,
        palette_count: 4,
        transparent_index: -1,
        delay: 53,
        x: 0,
        y: 0,
        width: w,
        height: h,
        disposal: 0,
    }];

    let gif = write_gif(w, h, &frames, &vec![lzw]);

    let gce_pos = gif.windows(2).position(|w| w == [0x21, 0xF9]).unwrap();
    let delay_lo = gif[gce_pos + 4];
    let delay_hi = gif[gce_pos + 5];
    let delay_cs = delay_lo as u16 | ((delay_hi as u16) << 8);
    assert_eq!(delay_cs, 5, "53ms should round to 5 centiseconds");
}

#[test]
fn test_gif_palette_padding() {
    let w: u16 = 2;
    let h: u16 = 2;

    let palette = vec![255u8, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 128, 0, 128, 255];
    let indexed = vec![0, 1, 2, 3];

    let min_code_size = compute_min_code_size(5, -1);
    assert_eq!(min_code_size, 3, "5 colors pads to 8, log2(8)=3");

    let lzw = lzw_encode(&indexed, min_code_size);

    let frames = vec![GifFrame {
        indexed,
        palette,
        palette_count: 5,
        transparent_index: -1,
        delay: 100,
        x: 0,
        y: 0,
        width: w,
        height: h,
        disposal: 1,
    }];

    let gif = write_gif(w, h, &frames, &vec![lzw]);

    let img_desc_pos = gif.windows(1).enumerate()
        .find(|(pos, _)| *pos > 30 && gif[*pos] == 0x2C)
        .unwrap().0;
    let lct_packed = gif[img_desc_pos + 9];
    assert_eq!(lct_packed & 0x80, 0x80, "LCT flag");
    let size_field = lct_packed & 0x07;
    assert_eq!(size_field, 2, "size field for 8-entry LCT (2^(2+1)=8)");
}
