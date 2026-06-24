use gifhero_core::gif::{write_gif, GifFrame, compute_min_code_size};
use gifhero_core::lzw::lzw_encode;

fn to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

#[test]
fn crossval_2_frame_solid_gif() {
    let w: u16 = 4;
    let h: u16 = 4;
    let pixels = w as usize * h as usize;

    // RGBA palette (Rust API) — red, blue, green, black
    let palette = vec![
        255, 0, 0, 255,    // 0: red
        0, 0, 255, 255,    // 1: blue
        0, 255, 0, 255,    // 2: green
        0, 0, 0, 255,      // 3: black
    ];

    let frame1_indexed = vec![0u8; pixels]; // all red
    let frame2_indexed = vec![1u8; pixels]; // all blue

    let min_code_size = compute_min_code_size(4, -1);
    let lzw1 = lzw_encode(&frame1_indexed, min_code_size);
    let lzw2 = lzw_encode(&frame2_indexed, min_code_size);

    let frames = vec![
        GifFrame {
            indexed: frame1_indexed,
            palette: palette.clone(),
            palette_count: 4,
            transparent_index: -1,
            delay: 100, // 100ms → 10 centiseconds
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

    let expected = "4749463839610400040070000021ff0b4e45545343415045322e30030100000021f904040a0000002c000000000400040081ff00000000ff00ff000000000204848f09050021f904040a0000002c000000000400040081ff00000000ff00ff0000000002048c8f1905003b";
    let hex = to_hex(&gif);

    assert_eq!(gif.len(), 107, "GIF size");
    assert_eq!(hex, expected, "byte-identical GIF");
}

#[test]
fn crossval_1_frame_transparent_gif() {
    let w: u16 = 2;
    let h: u16 = 2;

    // RGBA palette — red, green, blue, yellow, transparent
    let palette = vec![
        255, 0, 0, 255,      // 0: red
        0, 255, 0, 255,      // 1: green
        0, 0, 255, 255,      // 2: blue
        255, 255, 0, 255,    // 3: yellow
        0, 0, 0, 0,          // 4: transparent
    ];

    let indexed = vec![0u8, 4, 1, 4];

    let min_code_size = compute_min_code_size(5, 4);
    let lzw = lzw_encode(&indexed, min_code_size);

    let frames = vec![GifFrame {
        indexed,
        palette,
        palette_count: 5,
        transparent_index: 4,
        delay: 50, // 50ms → 5 centiseconds
        x: 0,
        y: 0,
        width: w,
        height: h,
        disposal: 1,
    }];

    let lzw_data = vec![lzw];
    let gif = write_gif(w, h, &frames, &lzw_data);

    let expected = "4749463839610200020070000021ff0b4e45545343415045322e30030100000021f90405050004002c000000000200020082ff000000ff000000ffffff000000000000000000000000000303081494003b";
    let hex = to_hex(&gif);

    assert_eq!(gif.len(), 81, "GIF size");
    assert_eq!(hex, expected, "byte-identical GIF with transparency");
}
