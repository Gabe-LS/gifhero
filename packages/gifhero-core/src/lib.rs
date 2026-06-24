pub mod probe;
pub mod denoise;
pub mod lzw;
pub mod gif;
pub mod quantize;
pub mod subframe;
pub mod lanczos3;

mod dither;

#[cfg(feature = "wasm")]
mod wasm;

use gif::{GifFrame, write_gif, compute_min_code_size};
use lzw::{lzw_encode, lzw_encode_lossy};
use probe::probe_frames;
use quantize::{quantize_simple, quantize_with_background, build_shared_palette, remap_with_palette};
use subframe::{find_changed_bbox, crop_indexed, decode_frame_to_canvas, trim_palette, rgba_to_rgb_palette};

#[derive(Clone, Copy, PartialEq)]
pub enum Preset {
    Quality,
    Balanced,
}

pub struct EncodeOptions {
    pub width: usize,
    pub height: usize,
    pub preset: Preset,
    pub target_width: Option<usize>,
    pub target_height: Option<usize>,
    pub lossy_lzw: Option<u8>,
    pub max_colors: Option<u16>,
    pub stale_threshold: Option<u8>,
}

pub struct EncodeFrame {
    pub data: Vec<u8>,
    pub delay: u16,
}

pub fn encode(frames: &[EncodeFrame], opts: &EncodeOptions) -> Vec<u8> {
    if frames.is_empty() {
        panic!("At least one frame is required");
    }

    let mut width = opts.width;
    let mut height = opts.height;
    let src_width = width;

    let mut frame_data: Vec<Vec<u8>> = frames.iter().map(|f| f.data.clone()).collect();
    let delays: Vec<u16> = frames.iter().map(|f| f.delay).collect();

    // Downscale
    if let Some(tw) = opts.target_width {
        if tw < width {
            let dst_w = tw;
            let dst_h = opts.target_height.unwrap_or_else(|| height * dst_w / width);
            for frame in frame_data.iter_mut() {
                *frame = lanczos3::downsample_lanczos3(frame, width, height, dst_w, dst_h);
            }
            width = dst_w;
            height = dst_h;
        }
    }
    let _downscale_ratio = src_width as f64 / width as f64;

    let is_quality = opts.preset == Preset::Quality;
    let num_pixels = width * height;

    // Temporal denoise (balanced only)
    if !is_quality && frame_data.len() >= 3 {
        let step = (frame_data.len() / 6).max(1);
        let mut sub_perceptual = 0usize;
        let mut changed = 0usize;
        let mut total_checked = 0usize;

        let mut f = step;
        while f < frame_data.len() {
            let a = &frame_data[f];
            let b = &frame_data[f - 1];
            for i in 0..num_pixels {
                let si = i * 4;
                let max_dev = (a[si] as i16 - b[si] as i16).abs()
                    .max((a[si+1] as i16 - b[si+1] as i16).abs())
                    .max((a[si+2] as i16 - b[si+2] as i16).abs());
                if max_dev >= 1 && max_dev <= 2 { sub_perceptual += 1; }
                if max_dev > 5 { changed += 1; }
                total_checked += 1;
            }
            f += step;
        }

        let has_noise = total_checked > 0 && sub_perceptual as f64 / total_checked as f64 > 0.05;
        let has_motion = total_checked > 0 && changed as f64 / total_checked as f64 > 0.02;
        if has_noise && has_motion {
            denoise::denoise_frames(&mut frame_data, width, height, 3);
        }
    }

    // Probe
    let refs: Vec<&[u8]> = frame_data.iter().map(|f| f.as_slice()).collect();
    let probe_result = probe_frames(&refs, width, height, 3);

    // Adaptive parameters
    let preset_quality: u8 = if is_quality { 98 } else { 95 };
    let speed: i32 = 1;

    let mut adaptive_max_colors: u32 = opts.max_colors.unwrap_or(256) as u32;
    if !is_quality && probe_result.color_complexity >= 20000 {
        adaptive_max_colors = adaptive_max_colors.min(192);
    } else if is_quality && probe_result.color_complexity >= 30000 {
        adaptive_max_colors = adaptive_max_colors.min(224);
    }

    let complexity = probe_result.motion_level * probe_result.color_complexity as f64;
    let motion_adjust = if probe_result.motion_level > 0.2 {
        -(((probe_result.motion_level - 0.2) * 5.0).min(3.0).round() as i32)
    } else {
        0
    };

    let auto_threshold = if is_quality {
        (4.0 + 6.0 * (complexity / 5000.0).min(1.0)).round() as i32 + motion_adjust
    } else {
        (5.0 + 5.0 * (complexity / 5000.0).min(1.0)).round() as i32 + motion_adjust
    };
    let auto_threshold = auto_threshold.clamp(2, 10) as u8;

    let stale_threshold = opts.stale_threshold.unwrap_or(auto_threshold);

    let base_lzw: u8 = 4;
    let adaptive_lzw = opts.lossy_lzw.unwrap_or_else(|| {
        let v = (base_lzw as f64 + probe_result.color_complexity as f64 / 3000.0).round() as u8;
        v.clamp(base_lzw, 5)
    });

    // Shared palette
    let use_shared = opts.target_width.is_some() || probe_result.color_complexity >= 8000;
    let shared_palette: Option<Vec<u8>> = if use_shared {
        let step = (frame_data.len() / 10).max(1);
        let mut sampled: Vec<&[u8]> = Vec::new();
        let mut f = 0;
        while f < frame_data.len() {
            sampled.push(&frame_data[f]);
            f += step;
        }
        let pal = build_shared_palette(
            &sampled, width, height,
            0, preset_quality, speed,
            (adaptive_max_colors - 1).max(2),
        );
        Some(pal)
    } else {
        None
    };

    // Importance map
    let mut importance_map = vec![0u8; num_pixels];
    for j in 0..num_pixels {
        importance_map[j] = if probe_result.static_mask[j] != 0 { 0 } else { 255 };
    }

    let scene_changes: std::collections::HashSet<usize> =
        probe_result.keyframes.iter().copied().collect();

    let mut gif_frames: Vec<GifFrame> = Vec::with_capacity(frame_data.len());
    let mut canvas = vec![0u8; num_pixels * 4];
    let mut prev_palette_rgb: Vec<u8> = Vec::new();

    for i in 0..frame_data.len() {
        let delay_ms = delays[i];

        if i == 0 || scene_changes.contains(&i) {
            if i > 0 {
                canvas.fill(0);
            }

            let r = quantize_simple(
                &frame_data[i], width, height,
                0, preset_quality, speed, adaptive_max_colors,
            );

            let rgb_pal = rgba_to_rgb_palette(&r.palette, r.palette_count);
            let trimmed = trim_palette(&rgb_pal, &r.indexed, -1);

            decode_frame_to_canvas(&mut canvas, &trimmed.indexed, &trimmed.palette, width, height);

            prev_palette_rgb = trimmed.palette.clone();

            gif_frames.push(GifFrame {
                indexed: trimmed.indexed,
                palette: trimmed.palette,
                palette_count: trimmed.palette_count,
                transparent_index: -1,
                delay: delay_ms,
                x: 0,
                y: 0,
                width: width as u16,
                height: height as u16,
                disposal: 0,
            });
            continue;
        }

        // Frames 1+: background-aware
        let mut input_rgba = frame_data[i].clone();

        for j in 0..num_pixels {
            if probe_result.static_mask[j] != 0 {
                input_rgba[j * 4 + 3] = 0;
            }
        }

        let fm = if i < probe_result.per_frame_motion.len() {
            probe_result.per_frame_motion[i]
        } else {
            probe_result.motion_level
        };
        let frame_threshold = if !is_quality && fm < 0.02 {
            (stale_threshold as u16 + 1).min(10) as u8
        } else {
            stale_threshold
        };

        for j in 0..num_pixels {
            if input_rgba[j * 4 + 3] == 0 { continue; }
            let si = j * 4;
            let d = (input_rgba[si] as i16 - canvas[si] as i16).abs()
                .max((input_rgba[si+1] as i16 - canvas[si+1] as i16).abs())
                .max((input_rgba[si+2] as i16 - canvas[si+2] as i16).abs());
            if d <= frame_threshold as i16 {
                input_rgba[si + 3] = 0;
            }
        }

        let r = if let Some(ref sp) = shared_palette {
            remap_with_palette(&input_rgba, width, height, sp, &canvas, 1.0)
        } else {
            quantize_with_background(
                &input_rgba, width, height,
                &canvas, &importance_map,
                0, preset_quality, speed, adaptive_max_colors,
            )
        };

        let t_idx = r.transparent_index;

        // Find bbox
        let bbox = find_changed_bbox(&r.indexed, width, height, t_idx);

        if bbox.is_none() {
            gif_frames.push(GifFrame {
                indexed: vec![0],
                palette: prev_palette_rgb.clone(),
                palette_count: prev_palette_rgb.len() / 3,
                transparent_index: 0,
                delay: delay_ms,
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                disposal: 0,
            });
        } else {
            let bbox = bbox.unwrap();
            let cropped = crop_indexed(&r.indexed, width, &bbox);

            let rgb_pal = rgba_to_rgb_palette(&r.palette, r.palette_count);

            if t_idx >= 0 {
                let trimmed = trim_palette(&rgb_pal, &cropped, t_idx);
                prev_palette_rgb = trimmed.palette.clone();

                gif_frames.push(GifFrame {
                    indexed: trimmed.indexed,
                    palette: trimmed.palette,
                    palette_count: trimmed.palette_count,
                    transparent_index: trimmed.transparent_index,
                    delay: delay_ms,
                    x: bbox.x as u16,
                    y: bbox.y as u16,
                    width: bbox.w as u16,
                    height: bbox.h as u16,
                    disposal: 0,
                });
            } else {
                prev_palette_rgb = rgb_pal.clone();

                gif_frames.push(GifFrame {
                    indexed: cropped,
                    palette: rgb_pal,
                    palette_count: r.palette_count,
                    transparent_index: -1,
                    delay: delay_ms,
                    x: bbox.x as u16,
                    y: bbox.y as u16,
                    width: bbox.w as u16,
                    height: bbox.h as u16,
                    disposal: 0,
                });
            }
        }

        // Update canvas from FULL indexed (not cropped)
        for j in 0..num_pixels {
            if r.indexed[j] as i32 != t_idx {
                let pi = r.indexed[j] as usize * 4;
                let ci = j * 4;
                canvas[ci] = r.palette[pi];
                canvas[ci + 1] = r.palette[pi + 1];
                canvas[ci + 2] = r.palette[pi + 2];
                canvas[ci + 3] = 255;
            }
        }
    }

    // LZW encode + GIF assembly
    let mut lzw_data: Vec<Vec<u8>> = Vec::with_capacity(gif_frames.len());
    for frame in &gif_frames {
        let min_cs = compute_min_code_size(frame.palette_count, frame.transparent_index);
        if adaptive_lzw > 0 {
            lzw_data.push(lzw_encode_lossy(
                &frame.indexed, min_cs,
                &frame.palette, frame.palette_count,
                adaptive_lzw, frame.transparent_index,
            ));
        } else {
            lzw_data.push(lzw_encode(&frame.indexed, min_cs));
        }
    }

    write_gif(width as u16, height as u16, &gif_frames, &lzw_data)
}

// ── Shared helpers for both sequential and parallel paths ────────

struct PipelineParams {
    #[allow(dead_code)]
    is_quality: bool,
    preset_quality: u8,
    speed: i32,
    adaptive_max_colors: u32,
    stale_threshold: u8,
    adaptive_lzw: u8,
}

fn compute_pipeline_params(
    probe: &probe::ProbeResult,
    opts: &EncodeOptions,
    is_quality: bool,
) -> PipelineParams {
    let preset_quality: u8 = if is_quality { 98 } else { 95 };
    let speed: i32 = 1;

    let mut adaptive_max_colors: u32 = opts.max_colors.unwrap_or(256) as u32;
    if !is_quality && probe.color_complexity >= 20000 {
        adaptive_max_colors = adaptive_max_colors.min(192);
    } else if is_quality && probe.color_complexity >= 30000 {
        adaptive_max_colors = adaptive_max_colors.min(224);
    }

    let complexity = probe.motion_level * probe.color_complexity as f64;
    let motion_adjust = if probe.motion_level > 0.2 {
        -(((probe.motion_level - 0.2) * 5.0).min(3.0).round() as i32)
    } else {
        0
    };

    let auto_threshold = if is_quality {
        (4.0 + 6.0 * (complexity / 5000.0).min(1.0)).round() as i32 + motion_adjust
    } else {
        (5.0 + 5.0 * (complexity / 5000.0).min(1.0)).round() as i32 + motion_adjust
    };
    let auto_threshold = auto_threshold.clamp(2, 10) as u8;
    let stale_threshold = opts.stale_threshold.unwrap_or(auto_threshold);

    let base_lzw: u8 = 4;
    let adaptive_lzw = opts.lossy_lzw.unwrap_or_else(|| {
        let v = (base_lzw as f64 + probe.color_complexity as f64 / 3000.0).round() as u8;
        v.clamp(base_lzw, 5)
    });

    PipelineParams {
        is_quality,
        preset_quality,
        speed,
        adaptive_max_colors,
        stale_threshold,
        adaptive_lzw,
    }
}

fn lzw_encode_frame(frame: &GifFrame, adaptive_lzw: u8) -> Vec<u8> {
    let min_cs = compute_min_code_size(frame.palette_count, frame.transparent_index);
    if adaptive_lzw > 0 {
        lzw_encode_lossy(
            &frame.indexed, min_cs,
            &frame.palette, frame.palette_count,
            adaptive_lzw, frame.transparent_index,
        )
    } else {
        lzw_encode(&frame.indexed, min_cs)
    }
}

// ── Parallel encode ─────────────────────────────────────────────

/// Parallel encode using Rayon. Same output quality as encode(),
/// with multi-core speedup on Lanczos3 downscaling and LZW encoding.
/// Quantization and sub-frame pass remain sequential (canvas dependency).
#[cfg(feature = "cli")]
pub fn encode_parallel(frames: &[EncodeFrame], opts: &EncodeOptions) -> Vec<u8> {
    use rayon::prelude::*;

    if frames.is_empty() {
        panic!("At least one frame is required");
    }

    let mut width = opts.width;
    let mut height = opts.height;
    let src_width = width;

    let delays: Vec<u16> = frames.iter().map(|f| f.delay).collect();

    // ── 1. Parallel Lanczos3 downscale ──
    let mut frame_data: Vec<Vec<u8>> = if let Some(tw) = opts.target_width {
        if tw < width {
            let dst_w = tw;
            let dst_h = opts.target_height.unwrap_or_else(|| height * dst_w / width);
            let resized: Vec<Vec<u8>> = frames.par_iter()
                .map(|f| lanczos3::downsample_lanczos3(&f.data, width, height, dst_w, dst_h))
                .collect();
            width = dst_w;
            height = dst_h;
            resized
        } else {
            frames.iter().map(|f| f.data.clone()).collect()
        }
    } else {
        frames.iter().map(|f| f.data.clone()).collect()
    };
    let _downscale_ratio = src_width as f64 / width as f64;

    let is_quality = opts.preset == Preset::Quality;
    let num_pixels = width * height;

    // ── 2. Sequential denoise ──
    if !is_quality && frame_data.len() >= 3 {
        let step = (frame_data.len() / 6).max(1);
        let mut sub_perceptual = 0usize;
        let mut changed = 0usize;
        let mut total_checked = 0usize;

        let mut f = step;
        while f < frame_data.len() {
            let a = &frame_data[f];
            let b = &frame_data[f - 1];
            for i in 0..num_pixels {
                let si = i * 4;
                let max_dev = (a[si] as i16 - b[si] as i16).abs()
                    .max((a[si+1] as i16 - b[si+1] as i16).abs())
                    .max((a[si+2] as i16 - b[si+2] as i16).abs());
                if max_dev >= 1 && max_dev <= 2 { sub_perceptual += 1; }
                if max_dev > 5 { changed += 1; }
                total_checked += 1;
            }
            f += step;
        }

        let has_noise = total_checked > 0 && sub_perceptual as f64 / total_checked as f64 > 0.05;
        let has_motion = total_checked > 0 && changed as f64 / total_checked as f64 > 0.02;
        if has_noise && has_motion {
            denoise::denoise_frames(&mut frame_data, width, height, 3);
        }
    }

    // ── 3. Sequential probe ──
    let refs: Vec<&[u8]> = frame_data.iter().map(|f| f.as_slice()).collect();
    let probe_result = probe_frames(&refs, width, height, 3);

    // ── 4. Adaptive parameters ──
    let params = compute_pipeline_params(&probe_result, opts, is_quality);

    // ── 5. Shared palette ──
    let use_shared = opts.target_width.is_some() || probe_result.color_complexity >= 8000;
    let shared_palette: Option<Vec<u8>> = if use_shared {
        let step = (frame_data.len() / 10).max(1);
        let mut sampled: Vec<&[u8]> = Vec::new();
        let mut f = 0;
        while f < frame_data.len() {
            sampled.push(&frame_data[f]);
            f += step;
        }
        Some(build_shared_palette(
            &sampled, width, height,
            0, params.preset_quality, params.speed,
            (params.adaptive_max_colors - 1).max(2),
        ))
    } else {
        None
    };

    let importance_map: Vec<u8> = probe_result.static_mask.iter()
        .map(|&s| if s != 0 { 0 } else { 255 })
        .collect();

    let scene_changes: std::collections::HashSet<usize> =
        probe_result.keyframes.iter().copied().collect();

    // ── 6. Sequential quantize + sub-frame (canvas dependency) ──
    let mut gif_frames: Vec<GifFrame> = Vec::with_capacity(frame_data.len());
    let mut canvas = vec![0u8; num_pixels * 4];
    let mut prev_palette_rgb: Vec<u8> = Vec::new();

    for i in 0..frame_data.len() {
        let delay_ms = delays[i];

        if i == 0 || scene_changes.contains(&i) {
            if i > 0 {
                canvas.fill(0);
            }

            let r = quantize_simple(
                &frame_data[i], width, height,
                0, params.preset_quality, params.speed, params.adaptive_max_colors,
            );

            let rgb_pal = rgba_to_rgb_palette(&r.palette, r.palette_count);
            let trimmed = trim_palette(&rgb_pal, &r.indexed, -1);

            decode_frame_to_canvas(&mut canvas, &trimmed.indexed, &trimmed.palette, width, height);
            prev_palette_rgb = trimmed.palette.clone();

            gif_frames.push(GifFrame {
                indexed: trimmed.indexed,
                palette: trimmed.palette,
                palette_count: trimmed.palette_count,
                transparent_index: -1,
                delay: delay_ms,
                x: 0, y: 0,
                width: width as u16, height: height as u16,
                disposal: 0,
            });
            continue;
        }

        let mut input_rgba = frame_data[i].clone();

        for j in 0..num_pixels {
            if probe_result.static_mask[j] != 0 {
                input_rgba[j * 4 + 3] = 0;
            }
        }

        let fm = if i < probe_result.per_frame_motion.len() {
            probe_result.per_frame_motion[i]
        } else {
            probe_result.motion_level
        };
        let frame_threshold = if !is_quality && fm < 0.02 {
            (params.stale_threshold as u16 + 1).min(10) as u8
        } else {
            params.stale_threshold
        };

        for j in 0..num_pixels {
            if input_rgba[j * 4 + 3] == 0 { continue; }
            let si = j * 4;
            let d = (input_rgba[si] as i16 - canvas[si] as i16).abs()
                .max((input_rgba[si+1] as i16 - canvas[si+1] as i16).abs())
                .max((input_rgba[si+2] as i16 - canvas[si+2] as i16).abs());
            if d <= frame_threshold as i16 {
                input_rgba[si + 3] = 0;
            }
        }

        let r = if let Some(ref sp) = shared_palette {
            remap_with_palette(&input_rgba, width, height, sp, &canvas, 1.0)
        } else {
            quantize_with_background(
                &input_rgba, width, height,
                &canvas, &importance_map,
                0, params.preset_quality, params.speed, params.adaptive_max_colors,
            )
        };

        let t_idx = r.transparent_index;
        let bbox = find_changed_bbox(&r.indexed, width, height, t_idx);

        if bbox.is_none() {
            gif_frames.push(GifFrame {
                indexed: vec![0],
                palette: prev_palette_rgb.clone(),
                palette_count: prev_palette_rgb.len() / 3,
                transparent_index: 0,
                delay: delay_ms,
                x: 0, y: 0,
                width: 1, height: 1,
                disposal: 0,
            });
        } else {
            let bbox = bbox.unwrap();
            let cropped = crop_indexed(&r.indexed, width, &bbox);
            let rgb_pal = rgba_to_rgb_palette(&r.palette, r.palette_count);

            if t_idx >= 0 {
                let trimmed = trim_palette(&rgb_pal, &cropped, t_idx);
                prev_palette_rgb = trimmed.palette.clone();
                gif_frames.push(GifFrame {
                    indexed: trimmed.indexed,
                    palette: trimmed.palette,
                    palette_count: trimmed.palette_count,
                    transparent_index: trimmed.transparent_index,
                    delay: delay_ms,
                    x: bbox.x as u16, y: bbox.y as u16,
                    width: bbox.w as u16, height: bbox.h as u16,
                    disposal: 0,
                });
            } else {
                prev_palette_rgb = rgb_pal.clone();
                gif_frames.push(GifFrame {
                    indexed: cropped,
                    palette: rgb_pal,
                    palette_count: r.palette_count,
                    transparent_index: -1,
                    delay: delay_ms,
                    x: bbox.x as u16, y: bbox.y as u16,
                    width: bbox.w as u16, height: bbox.h as u16,
                    disposal: 0,
                });
            }
        }

        for j in 0..num_pixels {
            if r.indexed[j] as i32 != t_idx {
                let pi = r.indexed[j] as usize * 4;
                let ci = j * 4;
                canvas[ci] = r.palette[pi];
                canvas[ci + 1] = r.palette[pi + 1];
                canvas[ci + 2] = r.palette[pi + 2];
                canvas[ci + 3] = 255;
            }
        }
    }

    // ── 7. Parallel LZW encode ──
    let lzw_data: Vec<Vec<u8>> = gif_frames.par_iter()
        .map(|frame| lzw_encode_frame(frame, params.adaptive_lzw))
        .collect();

    // ── 8. Sequential GIF assembly ──
    write_gif(width as u16, height as u16, &gif_frames, &lzw_data)
}
