use gifhero_core::{encode, encode_parallel, EncodeFrame, EncodeOptions, Preset};
use std::path::PathBuf;
use std::time::Instant;

fn load_frames(dir: &str, max_frames: usize) -> (Vec<Vec<u8>>, usize, usize) {
    let path = PathBuf::from(dir);
    let mut files: Vec<_> = std::fs::read_dir(&path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: encode_test <frames_dir> <output.gif> [target_width] [--single] [--quality]");
        std::process::exit(1);
    }

    let frames_dir = &args[1];
    let output_path = &args[2];
    let single_threaded = args.iter().any(|a| a == "--single");
    let is_quality = args.iter().any(|a| a == "--quality");

    let target_width: Option<usize> = args.iter()
        .filter(|a| !a.starts_with("--"))
        .nth(3)
        .and_then(|s| s.parse().ok());

    let (raw_frames, width, height) = load_frames(frames_dir, 10000);
    eprintln!("Loaded {} frames ({}x{})", raw_frames.len(), width, height);

    let frames: Vec<EncodeFrame> = raw_frames.into_iter().map(|data| EncodeFrame {
        data,
        delay: 50,
    }).collect();

    let opts = EncodeOptions {
        width,
        height,
        preset: if is_quality { Preset::Quality } else { Preset::Balanced },
        target_width,
        target_height: None,
        lossy_lzw: None,
        max_colors: None,
        stale_threshold: None,
    };

    let num_threads = rayon::current_num_threads();
    let mode = if single_threaded { "single-threaded" } else { &format!("parallel ({num_threads} threads)") };
    eprintln!("Mode: {mode}");

    let start = Instant::now();
    let gif = if single_threaded {
        encode(&frames, &opts)
    } else {
        encode_parallel(&frames, &opts)
    };
    let elapsed = start.elapsed();

    std::fs::write(output_path, &gif).unwrap();

    eprintln!("Encoded {} frames → {} bytes ({:.1} KB) in {:.3}s",
        frames.len(), gif.len(), gif.len() as f64 / 1024.0, elapsed.as_secs_f64());
}
