use clap::Parser;
use gifhero_core::{encode_parallel, EncodeFrame, EncodeOptions, Preset};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Instant;

#[derive(Parser)]
#[command(name = "gifhero", version, about = "High-quality GIF encoder")]
struct Cli {
    /// Input video file (any format ffmpeg supports)
    input: String,

    /// Output GIF path
    #[arg(short, long, default_value = "output.gif")]
    output: String,

    /// Target width in pixels (height auto from aspect ratio)
    #[arg(short, long)]
    width: Option<usize>,

    /// Target height in pixels (width auto from aspect ratio)
    #[arg(long)]
    height: Option<usize>,

    /// Frames per second
    #[arg(long, default_value = "20")]
    fps: u32,

    /// Encoding preset: quality or balanced
    #[arg(long, default_value = "balanced")]
    preset: String,

    /// Maximum duration in seconds
    #[arg(long)]
    max_duration: Option<f64>,

    /// Number of worker threads (default: all cores)
    #[arg(short = 'j', long)]
    threads: Option<usize>,

    /// Suppress progress output
    #[arg(short, long)]
    quiet: bool,
}

fn probe_dimensions(input: &str) -> (usize, usize) {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0:s=x",
            input,
        ])
        .output()
        .unwrap_or_else(|e| {
            eprintln!("Error: ffprobe not found — install ffmpeg. ({e})");
            std::process::exit(1);
        });

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("Error: ffprobe failed for '{}': {}", input, stderr.trim());
        std::process::exit(1);
    }

    let dims = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = dims.trim().split('x').collect();
    if parts.len() != 2 {
        eprintln!("Error: could not parse video dimensions from ffprobe output: '{}'", dims.trim());
        std::process::exit(1);
    }
    let w: usize = parts[0].parse().unwrap_or_else(|_| {
        eprintln!("Error: invalid width '{}'", parts[0]);
        std::process::exit(1);
    });
    let h: usize = parts[1].parse().unwrap_or_else(|_| {
        eprintln!("Error: invalid height '{}'", parts[1]);
        std::process::exit(1);
    });
    (w, h)
}

fn extract_frames(
    input: &str,
    fps: u32,
    max_duration: Option<f64>,
    src_w: usize,
    src_h: usize,
) -> Vec<Vec<u8>> {
    let fps_filter = format!("fps={fps}");
    let mut args: Vec<&str> = Vec::new();

    let duration_str;
    if let Some(dur) = max_duration {
        duration_str = format!("{dur}");
        args.extend_from_slice(&["-t", &duration_str]);
    }

    args.extend_from_slice(&[
        "-i", input,
        "-vf", &fps_filter,
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        "pipe:1",
    ]);

    let mut child = Command::new("ffmpeg")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("Error: ffmpeg not found — install ffmpeg. ({e})");
            std::process::exit(1);
        });

    let stdout = child.stdout.take().unwrap();
    let frame_size = src_w * src_h * 4;
    let mut frames: Vec<Vec<u8>> = Vec::new();
    let mut reader = std::io::BufReader::with_capacity(frame_size, stdout);
    let mut buf = vec![0u8; frame_size];

    while reader.read_exact(&mut buf).is_ok() {
        frames.push(buf.clone());
    }

    let status = child.wait().unwrap_or_else(|e| {
        eprintln!("Error: ffmpeg process failed: {e}");
        std::process::exit(1);
    });

    if frames.is_empty() {
        let mut stderr_buf = Vec::new();
        if let Some(mut stderr) = child.stderr.take() {
            stderr.read_to_end(&mut stderr_buf).ok();
        }
        let stderr_str = String::from_utf8_lossy(&stderr_buf);
        if !status.success() {
            eprintln!("Error: ffmpeg failed (exit {}): {}", status, stderr_str.trim());
        } else {
            eprintln!("Error: no frames extracted from '{}'", input);
        }
        std::process::exit(1);
    }

    frames
}

fn main() {
    let cli = Cli::parse();

    if !std::path::Path::new(&cli.input).exists() {
        eprintln!("Error: input file '{}' not found", cli.input);
        std::process::exit(1);
    }

    let preset = match cli.preset.as_str() {
        "quality" => Preset::Quality,
        "balanced" => Preset::Balanced,
        other => {
            eprintln!("Error: unknown preset '{}' (use 'quality' or 'balanced')", other);
            std::process::exit(1);
        }
    };

    if let Some(threads) = cli.threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global()
            .ok();
    }

    if !cli.quiet {
        eprintln!("Extracting frames from {}...", cli.input);
    }

    let (src_w, src_h) = probe_dimensions(&cli.input);
    let raw_frames = extract_frames(&cli.input, cli.fps, cli.max_duration, src_w, src_h);

    if !cli.quiet {
        eprintln!("Extracted {} frames ({}x{})", raw_frames.len(), src_w, src_h);
    }

    let delay_ms = (1000.0 / cli.fps as f64).round() as u16;
    let frames: Vec<EncodeFrame> = raw_frames.into_iter()
        .map(|data| EncodeFrame { data, delay: delay_ms })
        .collect();

    let opts = EncodeOptions {
        width: src_w,
        height: src_h,
        preset,
        target_width: cli.width,
        target_height: cli.height,
        lossy_lzw: None,
        max_colors: None,
        stale_threshold: None,
    };

    if !cli.quiet {
        let tw = cli.width.map(|w| format!(" → {}p", w)).unwrap_or_default();
        eprintln!("Encoding {} frames ({}x{}{}, {})...",
            frames.len(), src_w, src_h, tw, cli.preset);
    }

    let start = Instant::now();
    let gif = encode_parallel(&frames, &opts);
    let elapsed = start.elapsed();

    std::fs::write(&cli.output, &gif).unwrap_or_else(|e| {
        eprintln!("Error: failed to write '{}': {e}", cli.output);
        std::process::exit(1);
    });

    if !cli.quiet {
        eprintln!(
            "Done: {} KB in {:.1}s ({} frames, {}fps → {})",
            gif.len() / 1024,
            elapsed.as_secs_f64(),
            frames.len(),
            cli.fps,
            cli.output,
        );
    }
}
