use wasm_bindgen::prelude::*;
use crate::{encode, EncodeFrame, EncodeOptions, Preset};

#[wasm_bindgen]
pub fn encode_gif(
    frames_rgba: &[u8],
    frame_count: u32,
    width: u32,
    height: u32,
    delay_ms: u32,
    target_width: u32,
    preset: u8,
) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let fc = frame_count as usize;
    let frame_size = w * h * 4;

    let frames: Vec<EncodeFrame> = (0..fc)
        .map(|i| {
            let start = i * frame_size;
            EncodeFrame {
                data: frames_rgba[start..start + frame_size].to_vec(),
                delay: delay_ms as u16,
            }
        })
        .collect();

    let opts = EncodeOptions {
        width: w,
        height: h,
        preset: if preset == 1 { Preset::Quality } else { Preset::Balanced },
        target_width: if target_width > 0 { Some(target_width as usize) } else { None },
        target_height: None,
        lossy_lzw: None,
        max_colors: None,
        stale_threshold: None,
    };

    encode(&frames, &opts)
}
