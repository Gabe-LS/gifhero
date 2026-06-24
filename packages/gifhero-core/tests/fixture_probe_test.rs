use gifhero_core::probe::probe_frames;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest.join("../../test/fixtures/generated")
}

fn load_fixture_frames(name: &str, max_frames: usize) -> (Vec<Vec<u8>>, usize, usize) {
    let dir = fixtures_dir().join(name);
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read fixture dir {}: {e}", dir.display()))
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "png"))
        .map(|e| e.path())
        .collect();
    files.sort();
    files.truncate(max_frames);

    let mut frames = Vec::new();
    let mut width = 0usize;
    let mut height = 0usize;

    for path in &files {
        let file = std::fs::File::open(path).unwrap();
        let decoder = png::Decoder::new(file);
        let mut reader = decoder.read_info().unwrap();
        let info = reader.info();
        width = info.width as usize;
        height = info.height as usize;

        let mut buf = vec![0u8; reader.output_buffer_size()];
        let frame_info = reader.next_frame(&mut buf).unwrap();

        let rgba = match frame_info.color_type {
            png::ColorType::Rgba => buf[..frame_info.buffer_size()].to_vec(),
            png::ColorType::Rgb => {
                let rgb = &buf[..frame_info.buffer_size()];
                let pixel_count = width * height;
                let mut rgba = vec![0u8; pixel_count * 4];
                for i in 0..pixel_count {
                    rgba[i * 4] = rgb[i * 3];
                    rgba[i * 4 + 1] = rgb[i * 3 + 1];
                    rgba[i * 4 + 2] = rgb[i * 3 + 2];
                    rgba[i * 4 + 3] = 255;
                }
                rgba
            }
            other => panic!("unsupported color type: {other:?}"),
        };

        frames.push(rgba);
    }

    (frames, width, height)
}

#[test]
fn test_bbb_clip_01_probe() {
    let (frames, width, height) = load_fixture_frames("bbb-clip-01", 30);
    assert_eq!(frames.len(), 30);
    assert_eq!(width, 480);
    assert_eq!(height, 270);

    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
    let result = probe_frames(&refs, width, height, 3);

    let static_count: usize = result.static_mask.iter().map(|&v| v as usize).sum();

    println!("bbb-clip-01 static_mask pixels: {static_count}");
    println!("bbb-clip-01 motion_level: {}", result.motion_level);
    println!("bbb-clip-01 color_complexity: {}", result.color_complexity);
    println!("bbb-clip-01 keyframes: {:?}", result.keyframes);

    // TS reference: staticMaskPixelCount=3, motionLevel=0.15771..., colorComplexity=35243, sceneChanges=[26]
    assert_eq!(static_count, 3, "static mask pixel count mismatch");
    assert!(
        (result.motion_level - 0.15771338867603235).abs() < 1e-10,
        "motion_level mismatch: got {}",
        result.motion_level
    );
    assert_eq!(
        result.color_complexity, 35243,
        "color_complexity mismatch"
    );
    // Rust keyframes includes frame 0 + scene changes from TS
    assert_eq!(result.keyframes, vec![0, 26], "keyframes mismatch");
}

#[test]
fn test_bbb_clip_05_probe() {
    let (frames, width, height) = load_fixture_frames("bbb-clip-05", 30);
    assert_eq!(frames.len(), 30);
    assert_eq!(width, 480);
    assert_eq!(height, 270);

    let refs: Vec<&[u8]> = frames.iter().map(|f| f.as_slice()).collect();
    let result = probe_frames(&refs, width, height, 3);

    let static_count: usize = result.static_mask.iter().map(|&v| v as usize).sum();

    println!("bbb-clip-05 static_mask pixels: {static_count}");
    println!("bbb-clip-05 motion_level: {}", result.motion_level);
    println!("bbb-clip-05 color_complexity: {}", result.color_complexity);
    println!("bbb-clip-05 keyframes: {:?}", result.keyframes);

    // TS reference: staticMaskPixelCount=4, motionLevel=0.201004..., colorComplexity=26301, sceneChanges=[11]
    assert_eq!(static_count, 4, "static mask pixel count mismatch");
    assert!(
        (result.motion_level - 0.201004416773095).abs() < 1e-10,
        "motion_level mismatch: got {}",
        result.motion_level
    );
    assert_eq!(
        result.color_complexity, 26301,
        "color_complexity mismatch"
    );
    assert_eq!(result.keyframes, vec![0, 11], "keyframes mismatch");
}
