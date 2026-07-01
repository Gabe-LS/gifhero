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
use subframe::{find_changed_bbox, edge_sparse_suppress, crop_indexed, decode_frame_to_canvas, trim_palette, rgba_to_rgb_palette};

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
    let slices: Vec<&[u8]> = frames.iter().map(|f| f.data.as_slice()).collect();
    let delays: Vec<u16> = frames.iter().map(|f| f.delay).collect();
    encode_slices(&slices, &delays, opts)
}

/// Core encode function that works with borrowed frame data.
/// Avoids cloning when frames are already in contiguous memory (e.g. WASM).
pub fn encode_slices(frame_slices: &[&[u8]], delays: &[u16], opts: &EncodeOptions) -> Vec<u8> {
    if frame_slices.is_empty() {
        panic!("At least one frame is required");
    }

    let mut width = opts.width;
    let mut height = opts.height;
    let src_width = width;

    // Only clone frame data when we need to mutate (downscale or denoise).
    // Otherwise work directly with the borrowed slices.
    let mut owned_data: Option<Vec<Vec<u8>>> = None;

    // Downscale (requires mutation)
    if let Some(tw) = opts.target_width {
        if tw < width {
            let dst_w = tw;
            let dst_h = opts.target_height.unwrap_or_else(|| height * dst_w / width);
            let resized: Vec<Vec<u8>> = frame_slices.iter()
                .map(|f| lanczos3::downsample_lanczos3(f, width, height, dst_w, dst_h))
                .collect();
            width = dst_w;
            height = dst_h;
            owned_data = Some(resized);
        }
    }

    let is_quality = opts.preset == Preset::Quality;
    let num_pixels = width * height;

    // Helper to get frame data as slice (from owned or borrowed)
    let get_frame = |i: usize| -> &[u8] {
        if let Some(ref od) = owned_data {
            &od[i]
        } else {
            frame_slices[i]
        }
    };
    let frame_count = frame_slices.len();
    let _downscale_ratio = src_width as f64 / width as f64;

    // Temporal denoise (balanced only, requires owned data)
    if !is_quality && frame_count >= 3 {
        let step = (frame_count / 6).max(1);
        let mut sub_perceptual = 0usize;
        let mut changed = 0usize;
        let mut total_checked = 0usize;

        let mut f = step;
        while f < frame_count {
            let a = get_frame(f);
            let b = get_frame(f - 1);
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
            // Denoise requires mutation — materialize owned data if not already
            if owned_data.is_none() {
                owned_data = Some(frame_slices.iter().map(|f| f.to_vec()).collect());
            }
            denoise::denoise_frames(owned_data.as_mut().unwrap(), width, height, 3);
        }
    }

    // Rebuild get_frame closure after potential denoise mutation
    let get_frame = |i: usize| -> &[u8] {
        if let Some(ref od) = owned_data {
            &od[i]
        } else {
            frame_slices[i]
        }
    };

    // Probe
    let refs: Vec<&[u8]> = (0..frame_count).map(|i| get_frame(i)).collect();
    let probe_result = probe_frames(&refs, width, height, 3);

    // Adaptive parameters
    let preset_quality: u8 = if is_quality { 98 } else { 90 };
    let speed: i32 = if is_quality { 1 } else { 4 };

    let mut adaptive_max_colors: u32 = opts.max_colors.unwrap_or(256) as u32;
    if adaptive_max_colors >= 256 && !is_quality {
        let gdxc = probe_result.gradient_density * probe_result.color_complexity as f64;
        if probe_result.color_complexity >= 1000 {
            if gdxc > 14000.0 { /* keep 256 */ }
            else if gdxc > 9000.0 { adaptive_max_colors = adaptive_max_colors.min(192); }
            else { adaptive_max_colors = adaptive_max_colors.min(160); }
        }
    }
    if is_quality && probe_result.color_complexity >= 30000 {
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
        (4.0 + 4.0 * (complexity / 8000.0).min(1.0)).round() as i32 + motion_adjust
    };
    let stale_cap = if is_quality { 10 } else { 8 };
    let auto_threshold = auto_threshold.clamp(2, stale_cap) as u8;

    let stale_threshold = opts.stale_threshold.unwrap_or(auto_threshold);

    let adaptive_lzw = opts.lossy_lzw.unwrap_or(0);

    // Shared palette
    let use_shared = opts.target_width.is_some();
    let shared_palette: Option<Vec<u8>> = if use_shared {
        let step = (frame_count / 10).max(1);
        let mut sampled: Vec<&[u8]> = Vec::new();
        let mut f = 0;
        while f < frame_count {
            sampled.push(get_frame(f));
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

    // Palette fitness model
    const MAX_FRAMES_PER_PALETTE: usize = 10;
    const PALETTE_FITNESS_THRESHOLD: f64 = 8.0;

    let mut gif_frames: Vec<GifFrame> = Vec::with_capacity(frame_count);
    let mut canvas = vec![0u8; num_pixels * 4];
    let mut prev_palette_rgb: Vec<u8> = Vec::new();
    let mut active_palette_rgba: Option<Vec<u8>> = None;
    let mut frames_since_palette: usize = 0;

    for i in 0..frame_count {
        let delay_ms = delays[i];
        let is_keyframe = i == 0 || scene_changes.contains(&i);

        if is_keyframe {
            if i > 0 {
                canvas.fill(0);
            }

            let r = quantize_simple(
                get_frame(i), width, height,
                0, preset_quality, speed, adaptive_max_colors,
            );

            let rgb_pal = rgba_to_rgb_palette(&r.palette, r.palette_count);
            let trimmed = trim_palette(&rgb_pal, &r.indexed, -1);

            decode_frame_to_canvas(&mut canvas, &trimmed.indexed, &trimmed.palette, width, height);

            prev_palette_rgb = trimmed.palette.clone();
            active_palette_rgba = Some(build_shared_palette(
                &[get_frame(i)], width, height,
                0, preset_quality, speed, (adaptive_max_colors - 1).max(2),
            ));
            frames_since_palette = 0;

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

        // Palette fitness check: remap vs full quantize
        let mut use_remap = false;
        if let Some(ref ap) = active_palette_rgba {
            if frames_since_palette < MAX_FRAMES_PER_PALETTE {
                let p95 = palette_p95_distance(get_frame(i), ap, num_pixels);
                if p95 <= PALETTE_FITNESS_THRESHOLD { use_remap = true; }
            }
        }

        // Frames 1+: background-aware
        let curr = get_frame(i);
        let mut input_rgba = curr.to_vec();

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

        // Texture map: 3×3 neighborhood luminance range
        let mut tex_map = vec![0u8; num_pixels];
        for ty in 0..height {
            for tx in 0..width {
                let mut tmin: u16 = 765;
                let mut tmax: u16 = 0;
                let y_lo = if ty > 0 { ty - 1 } else { 0 };
                let y_hi = if ty + 1 < height { ty + 1 } else { height - 1 };
                let x_lo = if tx > 0 { tx - 1 } else { 0 };
                let x_hi = if tx + 1 < width { tx + 1 } else { width - 1 };
                for ny in y_lo..=y_hi {
                    for nx in x_lo..=x_hi {
                        let ti = (ny * width + nx) * 4;
                        let lum = input_rgba[ti] as u16 + input_rgba[ti + 1] as u16 + input_rgba[ti + 2] as u16;
                        if lum < tmin { tmin = lum; }
                        if lum > tmax { tmax = lum; }
                    }
                }
                tex_map[ty * width + tx] = ((tmax - tmin) as u32).min(255) as u8;
            }
        }

        // Direction-aware forward-look
        let next_src: Option<&[u8]> = if i + 1 < frame_count { Some(get_frame(i + 1)) } else { None };

        for j in 0..num_pixels {
            if input_rgba[j * 4 + 3] == 0 { continue; }
            let si = j * 4;
            let d = (input_rgba[si] as i16 - canvas[si] as i16).abs()
                .max((input_rgba[si+1] as i16 - canvas[si+1] as i16).abs())
                .max((input_rgba[si+2] as i16 - canvas[si+2] as i16).abs()) as u8;

            let tex = tex_map[j] as f32;
            let tex_factor = 0.6 + 0.4 * (tex / 40.0).min(1.0);
            let effective_threshold = frame_threshold as f32 * tex_factor;

            if (d as f32) <= effective_threshold {
                let mut keep_forward = false;
                if let Some(ns) = next_src {
                    if tex_map[j] < 40 && d > 1 {
                        let fwd_diff = (ns[si] as i16 - canvas[si] as i16).abs()
                            .max((ns[si+1] as i16 - canvas[si+1] as i16).abs())
                            .max((ns[si+2] as i16 - canvas[si+2] as i16).abs());
                        if fwd_diff > 4 {
                            let dr = (input_rgba[si] as i32 - canvas[si] as i32)
                                * (ns[si] as i32 - canvas[si] as i32);
                            let dg = (input_rgba[si+1] as i32 - canvas[si+1] as i32)
                                * (ns[si+1] as i32 - canvas[si+1] as i32);
                            let db = (input_rgba[si+2] as i32 - canvas[si+2] as i32)
                                * (ns[si+2] as i32 - canvas[si+2] as i32);
                            if dr + dg + db > 0 { keep_forward = true; }
                        }
                    }
                }
                if !keep_forward {
                    input_rgba[si + 3] = 0;
                }
            }
        }

        // Quantize or remap
        let r = if let Some(ref sp) = shared_palette {
            remap_with_palette(&input_rgba, width, height, sp, &canvas, 1.0)
        } else if use_remap {
            let ap = active_palette_rgba.as_ref().unwrap();
            remap_with_palette(&input_rgba, width, height, ap, &canvas, 1.0)
        } else {
            let qr = quantize_with_background(
                &input_rgba, width, height,
                &canvas, &importance_map,
                0, preset_quality, speed, adaptive_max_colors,
            );
            active_palette_rgba = Some(build_shared_palette(
                &[curr], width, height,
                0, preset_quality, speed, (adaptive_max_colors - 1).max(2),
            ));
            frames_since_palette = 0;
            qr
        };

        if use_remap { frames_since_palette += 1; }

        let t_idx = r.transparent_index;

        // Edge sparse suppression + bbox
        let mut indexed_mut = r.indexed;
        let bbox = if t_idx >= 0 {
            edge_sparse_suppress(
                &mut indexed_mut, curr, &canvas,
                width, height, t_idx, stale_threshold,
            )
        } else {
            find_changed_bbox(&indexed_mut, width, height, t_idx)
        };

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
            let cropped = crop_indexed(&indexed_mut, width, &bbox);

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
            if indexed_mut[j] as i32 != t_idx {
                let pi = indexed_mut[j] as usize * 4;
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

fn palette_p95_distance(rgba: &[u8], palette_rgba: &[u8], num_pixels: usize) -> f64 {
    let pal_count = palette_rgba.len() / 4;
    if pal_count == 0 { return 255.0; }
    let sample_step = 1.max(num_pixels / 2000);
    let mut dists: Vec<u16> = Vec::with_capacity(2000);
    let mut j = 0;
    while j < num_pixels {
        let si = j * 4;
        let sr = rgba[si];
        let sg = rgba[si + 1];
        let sb = rgba[si + 2];
        let mut best: u16 = 765;
        for p in 0..pal_count {
            let pi = p * 4;
            let d = (sr as i16 - palette_rgba[pi] as i16).unsigned_abs()
                + (sg as i16 - palette_rgba[pi + 1] as i16).unsigned_abs()
                + (sb as i16 - palette_rgba[pi + 2] as i16).unsigned_abs();
            if d < best { best = d; }
        }
        dists.push(best);
        j += sample_step;
    }
    dists.sort_unstable();
    let idx = (dists.len() as f64 * 0.95) as usize;
    dists.get(idx).copied().unwrap_or(0) as f64
}

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
    let preset_quality: u8 = if is_quality { 98 } else { 90 };
    let speed: i32 = if is_quality { 1 } else { 4 };

    let mut adaptive_max_colors: u32 = opts.max_colors.unwrap_or(256) as u32;
    if adaptive_max_colors >= 256 && !is_quality {
        let gdxc = probe.gradient_density * probe.color_complexity as f64;
        if probe.color_complexity >= 1000 {
            if gdxc > 14000.0 { /* keep 256 */ }
            else if gdxc > 9000.0 { adaptive_max_colors = adaptive_max_colors.min(192); }
            else { adaptive_max_colors = adaptive_max_colors.min(160); }
        }
    }
    if is_quality && probe.color_complexity >= 30000 {
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
        (4.0 + 4.0 * (complexity / 8000.0).min(1.0)).round() as i32 + motion_adjust
    };
    let stale_cap = if is_quality { 10 } else { 8 };
    let auto_threshold = auto_threshold.clamp(2, stale_cap) as u8;
    let stale_threshold = opts.stale_threshold.unwrap_or(auto_threshold);

    let adaptive_lzw = opts.lossy_lzw.unwrap_or(0);

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
    let use_shared = opts.target_width.is_some();
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

    const MAX_FRAMES_PER_PALETTE: usize = 10;
    const PALETTE_FITNESS_THRESHOLD: f64 = 8.0;

    // ── 6. Sequential quantize + sub-frame (canvas dependency) ──
    let mut gif_frames: Vec<GifFrame> = Vec::with_capacity(frame_data.len());
    let mut canvas = vec![0u8; num_pixels * 4];
    let mut prev_palette_rgb: Vec<u8> = Vec::new();
    let mut active_palette_rgba: Option<Vec<u8>> = None;
    let mut frames_since_palette: usize = 0;

    for i in 0..frame_data.len() {
        let delay_ms = delays[i];
        let is_kf = i == 0 || scene_changes.contains(&i);

        if is_kf {
            if i > 0 { canvas.fill(0); }

            let r = quantize_simple(
                &frame_data[i], width, height,
                0, params.preset_quality, params.speed, params.adaptive_max_colors,
            );

            let rgb_pal = rgba_to_rgb_palette(&r.palette, r.palette_count);
            let trimmed = trim_palette(&rgb_pal, &r.indexed, -1);

            decode_frame_to_canvas(&mut canvas, &trimmed.indexed, &trimmed.palette, width, height);
            prev_palette_rgb = trimmed.palette.clone();
            active_palette_rgba = Some(build_shared_palette(
                &[frame_data[i].as_slice()], width, height,
                0, params.preset_quality, params.speed, (params.adaptive_max_colors - 1).max(2),
            ));
            frames_since_palette = 0;

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

        let mut use_remap = false;
        if let Some(ref ap) = active_palette_rgba {
            if frames_since_palette < MAX_FRAMES_PER_PALETTE {
                let p95 = palette_p95_distance(&frame_data[i], ap, num_pixels);
                if p95 <= PALETTE_FITNESS_THRESHOLD { use_remap = true; }
            }
        }

        let curr = &frame_data[i];
        let mut input_rgba = curr.clone();

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

        let mut tex_map = vec![0u8; num_pixels];
        for ty in 0..height {
            for tx in 0..width {
                let mut tmin: u16 = 765;
                let mut tmax: u16 = 0;
                let y_lo = if ty > 0 { ty - 1 } else { 0 };
                let y_hi = if ty + 1 < height { ty + 1 } else { height - 1 };
                let x_lo = if tx > 0 { tx - 1 } else { 0 };
                let x_hi = if tx + 1 < width { tx + 1 } else { width - 1 };
                for ny in y_lo..=y_hi {
                    for nx in x_lo..=x_hi {
                        let ti = (ny * width + nx) * 4;
                        let lum = input_rgba[ti] as u16 + input_rgba[ti + 1] as u16 + input_rgba[ti + 2] as u16;
                        if lum < tmin { tmin = lum; }
                        if lum > tmax { tmax = lum; }
                    }
                }
                tex_map[ty * width + tx] = ((tmax - tmin) as u32).min(255) as u8;
            }
        }

        let next_src: Option<&[u8]> = if i + 1 < frame_data.len() { Some(&frame_data[i + 1]) } else { None };

        for j in 0..num_pixels {
            if input_rgba[j * 4 + 3] == 0 { continue; }
            let si = j * 4;
            let d = (input_rgba[si] as i16 - canvas[si] as i16).abs()
                .max((input_rgba[si+1] as i16 - canvas[si+1] as i16).abs())
                .max((input_rgba[si+2] as i16 - canvas[si+2] as i16).abs()) as u8;

            let tex = tex_map[j] as f32;
            let tex_factor = 0.6 + 0.4 * (tex / 40.0).min(1.0);
            let effective_threshold = frame_threshold as f32 * tex_factor;

            if (d as f32) <= effective_threshold {
                let mut keep_forward = false;
                if let Some(ns) = next_src {
                    if tex_map[j] < 40 && d > 1 {
                        let fwd_diff = (ns[si] as i16 - canvas[si] as i16).abs()
                            .max((ns[si+1] as i16 - canvas[si+1] as i16).abs())
                            .max((ns[si+2] as i16 - canvas[si+2] as i16).abs());
                        if fwd_diff > 4 {
                            let dr = (input_rgba[si] as i32 - canvas[si] as i32)
                                * (ns[si] as i32 - canvas[si] as i32);
                            let dg = (input_rgba[si+1] as i32 - canvas[si+1] as i32)
                                * (ns[si+1] as i32 - canvas[si+1] as i32);
                            let db = (input_rgba[si+2] as i32 - canvas[si+2] as i32)
                                * (ns[si+2] as i32 - canvas[si+2] as i32);
                            if dr + dg + db > 0 { keep_forward = true; }
                        }
                    }
                }
                if !keep_forward {
                    input_rgba[si + 3] = 0;
                }
            }
        }

        let r = if let Some(ref sp) = shared_palette {
            remap_with_palette(&input_rgba, width, height, sp, &canvas, 1.0)
        } else if use_remap {
            let ap = active_palette_rgba.as_ref().unwrap();
            remap_with_palette(&input_rgba, width, height, ap, &canvas, 1.0)
        } else {
            let qr = quantize_with_background(
                &input_rgba, width, height,
                &canvas, &importance_map,
                0, params.preset_quality, params.speed, params.adaptive_max_colors,
            );
            active_palette_rgba = Some(build_shared_palette(
                &[curr.as_slice()], width, height,
                0, params.preset_quality, params.speed, (params.adaptive_max_colors - 1).max(2),
            ));
            frames_since_palette = 0;
            qr
        };

        if use_remap { frames_since_palette += 1; }

        let t_idx = r.transparent_index;
        let mut indexed_mut = r.indexed;
        let bbox = if t_idx >= 0 {
            edge_sparse_suppress(
                &mut indexed_mut, curr, &canvas,
                width, height, t_idx, params.stale_threshold,
            )
        } else {
            find_changed_bbox(&indexed_mut, width, height, t_idx)
        };

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
            let cropped = crop_indexed(&indexed_mut, width, &bbox);
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
            if indexed_mut[j] as i32 != t_idx {
                let pi = indexed_mut[j] as usize * 4;
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
