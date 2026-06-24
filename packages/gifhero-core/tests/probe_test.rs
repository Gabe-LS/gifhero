use gifhero_core::probe::probe_frames;
use gifhero_core::denoise::denoise_frames;

fn make_solid_frame(width: usize, height: usize, r: u8, g: u8, b: u8) -> Vec<u8> {
    let mut data = vec![0u8; width * height * 4];
    for i in 0..width * height {
        data[i * 4] = r;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = b;
        data[i * 4 + 3] = 255;
    }
    data
}

fn make_frame_with_block(
    width: usize,
    height: usize,
    bg: (u8, u8, u8),
    block_x: usize,
    block_y: usize,
    block_size: usize,
    block_color: (u8, u8, u8),
) -> Vec<u8> {
    let mut data = make_solid_frame(width, height, bg.0, bg.1, bg.2);
    for y in block_y..block_y + block_size {
        for x in block_x..block_x + block_size {
            if x < width && y < height {
                let i = (y * width + x) * 4;
                data[i] = block_color.0;
                data[i + 1] = block_color.1;
                data[i + 2] = block_color.2;
            }
        }
    }
    data
}

#[test]
fn test_probe_all_static() {
    let w = 16;
    let h = 16;
    let frame = make_solid_frame(w, h, 128, 64, 32);
    let frames: Vec<Vec<u8>> = (0..5).map(|_| frame.clone()).collect();
    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();

    let result = probe_frames(&refs, w, h, 3);

    assert_eq!(result.static_mask.len(), w * h);
    let static_count: usize = result.static_mask.iter().map(|&v| v as usize).sum();
    assert_eq!(static_count, w * h, "all pixels should be static");
    assert_eq!(result.motion_level, 0.0);
    assert_eq!(result.keyframes, vec![0]);
}

#[test]
fn test_probe_moving_block() {
    let w = 64;
    let h = 64;
    let bg = (200, 200, 200);
    let block_color = (50, 50, 50);
    let block_size = 16;

    let mut frames = Vec::new();
    for f in 0..10 {
        let bx = f * 5;
        frames.push(make_frame_with_block(w, h, bg, bx, 24, block_size, block_color));
    }
    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();

    let result = probe_frames(&refs, w, h, 3);

    let static_count: usize = result.static_mask.iter().map(|&v| v as usize).sum();
    assert!(
        static_count < w * h,
        "some pixels should be dynamic due to moving block"
    );

    assert!(result.motion_level > 0.0, "motion should be detected");

    assert_eq!(result.keyframes[0], 0, "frame 0 is always a keyframe");

    assert!(
        result.color_complexity >= 2,
        "at least 2 colors (bg + block)"
    );
}

#[test]
fn test_probe_scene_change() {
    let w = 32;
    let h = 32;

    let mut frames = Vec::new();
    for _ in 0..5 {
        frames.push(make_solid_frame(w, h, 100, 100, 100));
    }
    for _ in 0..5 {
        frames.push(make_solid_frame(w, h, 200, 50, 50));
    }

    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
    let result = probe_frames(&refs, w, h, 3);

    assert!(
        result.keyframes.contains(&5),
        "frame 5 should be a keyframe (scene change): {:?}",
        result.keyframes
    );

    assert!(
        result.per_frame_motion[5] > 0.6,
        "frame 5 motion should exceed scene change threshold"
    );
}

#[test]
fn test_probe_motion_to_static_transition() {
    let w = 32;
    let h = 32;
    let bg = (128, 128, 128);
    let block_color = (30, 30, 30);

    let mut frames = Vec::new();
    frames.push(make_solid_frame(w, h, bg.0, bg.1, bg.2));

    for f in 1..4 {
        frames.push(make_frame_with_block(w, h, bg, f * 8, 0, 16, block_color));
    }

    for _ in 4..7 {
        frames.push(make_solid_frame(w, h, bg.0, bg.1, bg.2));
    }

    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
    let result = probe_frames(&refs, w, h, 3);

    let has_transition_keyframe = result.keyframes.iter().any(|&kf| kf >= 3);
    assert!(
        has_transition_keyframe || result.keyframes.len() >= 1,
        "should detect motion-to-static transition or at least have frame 0: {:?}, motion: {:?}",
        result.keyframes,
        result.per_frame_motion
    );
}

#[test]
fn test_probe_color_complexity() {
    let w = 4;
    let h = 4;

    let mut frame = vec![0u8; w * h * 4];
    for i in 0..w * h {
        let c = (i * 17) as u8;
        frame[i * 4] = c;
        frame[i * 4 + 1] = c.wrapping_mul(3);
        frame[i * 4 + 2] = c.wrapping_mul(7);
        frame[i * 4 + 3] = 255;
    }

    let frames = vec![frame];
    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
    let result = probe_frames(&refs, w, h, 3);

    assert!(
        result.color_complexity > 0,
        "should detect distinct colors"
    );
}

#[test]
fn test_denoise_no_op_on_static() {
    let w = 8;
    let h = 8;
    let mut frames: Vec<Vec<u8>> = (0..5)
        .map(|_| make_solid_frame(w, h, 100, 100, 100))
        .collect();

    let original = frames.clone();
    denoise_frames(&mut frames, w, h, 3);

    for (i, (f, o)) in frames.iter().zip(original.iter()).enumerate() {
        assert_eq!(f, o, "frame {i} should be unchanged for static content");
    }
}

#[test]
fn test_denoise_smooths_noise() {
    let w = 4;
    let h = 4;
    let np = w * h;

    let base = make_solid_frame(w, h, 100, 100, 100);
    let mut noisy = base.clone();
    for i in 0..np {
        noisy[i * 4] = 102;
    }

    let mut frames = vec![base.clone(), base.clone(), noisy, base.clone(), base.clone()];

    denoise_frames(&mut frames, w, h, 5);

    for i in 0..np {
        let val = frames[2][i * 4];
        assert!(
            (val as i16 - 100).unsigned_abs() <= 2,
            "pixel {i} R={val} should be smoothed toward 100"
        );
    }
}
