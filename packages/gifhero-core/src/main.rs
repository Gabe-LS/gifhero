use clap::Parser;
use gifhero_core::{encode_parallel, EncodeFrame, EncodeOptions, Preset};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::Instant;
use std::path::Path;

#[derive(Parser)]
#[command(name = "gifhero", version, about = "High-quality GIF encoder")]
struct Cli {
    /// Input video files (any format ffmpeg supports)
    #[arg(required = true)]
    inputs: Vec<String>,

    /// Output path (file for single input, directory for multiple)
    #[arg(short, long)]
    output: Option<String>,

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

    /// Number of worker threads per file (default: auto)
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

fn output_path_for(input: &str, out_dir: Option<&str>) -> String {
    let stem = Path::new(input)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    match out_dir {
        Some(dir) => {
            let dir = dir.trim_end_matches('/');
            format!("{}/{}.gif", dir, stem)
        }
        None => format!("{}.gif", stem),
    }
}

fn encode_one(
    input: &str,
    output: &str,
    preset: Preset,
    width: Option<usize>,
    height: Option<usize>,
    fps: u32,
    max_duration: Option<f64>,
    quiet: bool,
) {
    if !Path::new(input).exists() {
        eprintln!("Error: input file '{}' not found", input);
        return;
    }

    if !quiet {
        eprintln!("[{}] Extracting frames...", input);
    }

    let (src_w, src_h) = probe_dimensions(input);
    let raw_frames = extract_frames(input, fps, max_duration, src_w, src_h);

    if !quiet {
        eprintln!("[{}] {} frames ({}x{})", input, raw_frames.len(), src_w, src_h);
    }

    let delay_ms = (1000.0 / fps as f64).round() as u16;
    let frames: Vec<EncodeFrame> = raw_frames.into_iter()
        .map(|data| EncodeFrame { data, delay: delay_ms })
        .collect();

    let opts = EncodeOptions {
        width: src_w,
        height: src_h,
        preset,
        target_width: width,
        target_height: height,
        lossy_lzw: None,
        max_colors: None,
        stale_threshold: None,
    };

    let start = Instant::now();
    let gif = encode_parallel(&frames, &opts);
    let elapsed = start.elapsed();

    std::fs::write(output, &gif).unwrap_or_else(|e| {
        eprintln!("Error: failed to write '{}': {e}", output);
    });

    if !quiet {
        eprintln!(
            "[{}] {} KB in {:.1}s ({} frames, {}fps → {})",
            input,
            gif.len() / 1024,
            elapsed.as_secs_f64(),
            frames.len(),
            fps,
            output,
        );
    }
}

fn main() {
    let cli = Cli::parse();

    let preset = match cli.preset.as_str() {
        "quality" => Preset::Quality,
        "balanced" => Preset::Balanced,
        other => {
            eprintln!("Error: unknown preset '{}' (use 'quality' or 'balanced')", other);
            std::process::exit(1);
        }
    };

    let single = cli.inputs.len() == 1;

    if single {
        // Single file: use all threads, output to -o or input.gif
        if let Some(threads) = cli.threads {
            rayon::ThreadPoolBuilder::new()
                .num_threads(threads)
                .build_global()
                .ok();
        }

        let output = cli.output.clone()
            .unwrap_or_else(|| output_path_for(&cli.inputs[0], None));

        encode_one(
            &cli.inputs[0], &output, preset,
            cli.width, cli.height, cli.fps, cli.max_duration, cli.quiet,
        );
    } else {
        // Multiple files: parallel file processing with thread pool per file
        let num_cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let num_files = cli.inputs.len();

        // Sweet spot: 4 concurrent files with 4 threads each (from benchmarks)
        let concurrency = cli.threads.unwrap_or_else(|| {
            (num_cores / 4).clamp(1, num_files)
        });
        let threads_per_file = (num_cores / concurrency).max(1);

        // Create output directory if -o specified
        let out_dir = cli.output.as_deref();
        if let Some(dir) = out_dir {
            std::fs::create_dir_all(dir).unwrap_or_else(|e| {
                eprintln!("Error: cannot create output directory '{}': {e}", dir);
                std::process::exit(1);
            });
        }

        if !cli.quiet {
            eprintln!(
                "Encoding {} files ({} concurrent, {} threads each)",
                num_files, concurrency, threads_per_file,
            );
        }

        let total_start = Instant::now();

        // Process files in batches of `concurrency`
        let inputs = &cli.inputs;
        for batch_start in (0..inputs.len()).step_by(concurrency) {
            let batch_end = (batch_start + concurrency).min(inputs.len());
            let batch = &inputs[batch_start..batch_end];

            std::thread::scope(|s| {
                for input in batch {
                    let output = output_path_for(input, out_dir);
                    s.spawn(move || {
                        let pool = rayon::ThreadPoolBuilder::new()
                            .num_threads(threads_per_file)
                            .build()
                            .unwrap();
                        pool.install(|| {
                            encode_one(
                                input, &output, preset,
                                cli.width, cli.height, cli.fps, cli.max_duration, cli.quiet,
                            );
                        });
                    });
                }
            });
        }

        if !cli.quiet {
            let total = total_start.elapsed();
            eprintln!(
                "All done: {} files in {:.1}s ({:.1} files/s)",
                num_files,
                total.as_secs_f64(),
                num_files as f64 / total.as_secs_f64(),
            );
        }
    }
}
