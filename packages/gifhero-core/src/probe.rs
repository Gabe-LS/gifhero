pub struct ProbeResult {
    pub static_mask: Vec<u8>,
    pub motion_level: f64,
    pub color_complexity: usize,
    pub keyframes: Vec<usize>,
    pub per_frame_motion: Vec<f64>,
    pub gradient_density: f64,
    pub static_fraction: f64,
}

pub fn probe_frames(
    frames: &[&[u8]],
    width: usize,
    height: usize,
    tolerance: u8,
) -> ProbeResult {
    let num_pixels = width * height;

    let mut min_r = vec![255u8; num_pixels];
    let mut max_r = vec![0u8; num_pixels];
    let mut min_g = vec![255u8; num_pixels];
    let mut max_g = vec![0u8; num_pixels];
    let mut min_b = vec![255u8; num_pixels];
    let mut max_b = vec![0u8; num_pixels];

    for frame in frames {
        for i in 0..num_pixels {
            let idx = i * 4;
            let r = frame[idx];
            let g = frame[idx + 1];
            let b = frame[idx + 2];
            if r < min_r[i] { min_r[i] = r; }
            if r > max_r[i] { max_r[i] = r; }
            if g < min_g[i] { min_g[i] = g; }
            if g > max_g[i] { max_g[i] = g; }
            if b < min_b[i] { min_b[i] = b; }
            if b > max_b[i] { max_b[i] = b; }
        }
    }

    let mut static_mask = vec![0u8; num_pixels];
    for i in 0..num_pixels {
        let range_r = max_r[i] - min_r[i];
        let range_g = max_g[i] - min_g[i];
        let range_b = max_b[i] - min_b[i];
        if range_r <= tolerance && range_g <= tolerance && range_b <= tolerance {
            static_mask[i] = 1;
        }
    }

    let mut per_frame_motion = vec![0.0f64];
    let mut total_motion = 0.0f64;

    for f in 1..frames.len() {
        let curr = frames[f];
        let prev = frames[f - 1];
        let mut changed = 0usize;
        for i in 0..num_pixels {
            let idx = i * 4;
            let dr = (curr[idx] as i16 - prev[idx] as i16).unsigned_abs();
            let dg = (curr[idx + 1] as i16 - prev[idx + 1] as i16).unsigned_abs();
            let db = (curr[idx + 2] as i16 - prev[idx + 2] as i16).unsigned_abs();
            let max_delta = dr.max(dg).max(db);
            if max_delta > 5 {
                changed += 1;
            }
        }
        let fraction = changed as f64 / num_pixels as f64;
        per_frame_motion.push(fraction);
        total_motion += fraction;
    }

    let motion_level = if frames.len() > 1 {
        total_motion / (frames.len() - 1) as f64
    } else {
        0.0
    };

    let mut color_set = std::collections::HashSet::new();
    let mut f = 0;
    while f < frames.len() {
        let frame = frames[f];
        for i in 0..num_pixels {
            let idx = i * 4;
            let r6 = (frame[idx] >> 2) as u32;
            let g6 = (frame[idx + 1] >> 2) as u32;
            let b6 = (frame[idx + 2] >> 2) as u32;
            color_set.insert((r6 << 12) | (g6 << 6) | b6);
        }
        f += 5;
    }

    let mut keyframes = vec![0usize];
    for f in 1..frames.len() {
        if per_frame_motion[f] > 0.6 {
            keyframes.push(f);
        } else if f >= 2
            && per_frame_motion[f] < 0.02
            && per_frame_motion[f - 1] > 0.15
        {
            keyframes.push(f);
        }
    }

    // Gradient density: fraction of pixels in smooth gradient regions
    // Matches TS: sample every 5th frame, check 4 neighbors, divide by sample count
    let mut gradient_pixels = 0usize;
    let mut gradient_samples = 0usize;
    let mut gf = 0;
    while gf < frames.len() {
        let frame = frames[gf];
        for y in 1..(height.saturating_sub(1)) {
            for x in 1..(width.saturating_sub(1)) {
                let ci = (y * width + x) * 4;
                let cr = frame[ci];
                let cg = frame[ci + 1];
                let cb = frame[ci + 2];
                let mut smooth = true;
                for &(dx, dy) in &[(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
                    let ni = ((y as i32 + dy) as usize * width + (x as i32 + dx) as usize) * 4;
                    if (cr as i16 - frame[ni] as i16).unsigned_abs() > 3
                        || (cg as i16 - frame[ni + 1] as i16).unsigned_abs() > 3
                        || (cb as i16 - frame[ni + 2] as i16).unsigned_abs() > 3
                    {
                        smooth = false;
                        break;
                    }
                }
                if smooth { gradient_pixels += 1; }
                gradient_samples += 1;
            }
        }
        gf += 5;
    }
    let gradient_density = if gradient_samples > 0 {
        gradient_pixels as f64 / gradient_samples as f64
    } else {
        0.0
    };

    // Static fraction: fraction of pixels that are static
    let static_count = static_mask.iter().filter(|&&v| v != 0).count();
    let static_fraction = static_count as f64 / num_pixels as f64;

    ProbeResult {
        static_mask,
        motion_level,
        color_complexity: color_set.len(),
        keyframes,
        per_frame_motion,
        gradient_density,
        static_fraction,
    }
}
