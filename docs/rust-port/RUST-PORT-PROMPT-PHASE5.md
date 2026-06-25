# Rust Port — Phase 5 Prompt

Copy this entire message into a new Claude Code chat in the gifhero project directory.

---

## Rules

1. **Before writing any code**: `git checkout rust-port-phase4 && git checkout -b rust-port-phase5`
2. **Do not ask me questions.** Make reasonable decisions and keep going.
3. **Commit after each step** with a descriptive message.
4. When done, write a validation report to `packages/gifhero-core/PHASE5-REPORT.md`. Run the CLI on at least 2 video files (use files from `test/fixtures/videos/` if available, otherwise use any mp4 you can find or create a synthetic one with ffmpeg). Report: encode time, file size, frame count, FPS, and the exact command used. Also compare the CLI output against the `encode_test` example output for the same source to confirm they match.

## Context

gifhero is a TypeScript GIF encoding library being ported to Rust. The full plan is in `RUST-PORT-PLAN.md`.

**Phases 1-4** (done): the Rust crate at `packages/gifhero-core/` produces complete GIF files from raw RGBA frames with Rayon parallelism. Benchmarks (100 frames, 480×270):
- Sequential no threads: 2.15s
- With imagequant `threads` feature + Rayon parallel: **0.93s** (2.3× faster)
- Extrapolated for 333 frames at 1080p→480p: ~3s (matching gifski CLI)

The `imagequant` dependency already has `features = ["threads"]` enabled (committed on rust-port-phase4).

**Phase 5** (this phase): build the CLI binary that accepts video files via ffmpeg, encodes with the Rust pipeline, and writes a GIF.

## What to do

### Step 1: Implement main.rs with clap

```rust
use clap::Parser;

#[derive(Parser)]
#[command(name = "gifhero", about = "High-quality GIF encoder")]
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
```

### Step 2: ffmpeg frame extraction

Use ffmpeg as a subprocess to extract raw RGBA frames from the input video. This is the standard approach — gifski does the same thing.

```rust
use std::process::{Command, Stdio};
use std::io::Read;

fn extract_frames(input: &str, fps: u32, max_duration: Option<f64>) -> (Vec<Vec<u8>>, usize, usize) {
    // Step 1: Probe video dimensions with ffprobe
    let probe = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0",
               "-show_entries", "stream=width,height",
               "-of", "csv=p=0:s=x", input])
        .output()
        .expect("ffprobe not found — install ffmpeg");
    let dims = String::from_utf8_lossy(&probe.stdout);
    let parts: Vec<&str> = dims.trim().split('x').collect();
    let src_w: usize = parts[0].parse().expect("can't parse width");
    let src_h: usize = parts[1].parse().expect("can't parse height");

    // Step 2: Extract raw RGBA frames via ffmpeg pipe
    let mut args = vec![
        "-i", input,
        "-vf", &format!("fps={fps}"),
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
    ];
    // Add duration limit if specified
    // Use -t flag BEFORE input for faster seeking, or after for accurate trimming
    // ... build the full args

    let mut child = Command::new("ffmpeg")
        .args(&args)
        .arg("pipe:1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())  // suppress ffmpeg banner
        .spawn()
        .expect("ffmpeg not found — install ffmpeg");

    // Read all frames from stdout
    let stdout = child.stdout.take().unwrap();
    let frame_size = src_w * src_h * 4;
    let mut frames = Vec::new();
    let mut buf = vec![0u8; frame_size];
    let mut reader = std::io::BufReader::new(stdout);

    while reader.read_exact(&mut buf).is_ok() {
        frames.push(buf.clone());
        if let Some(max) = max_duration {
            if frames.len() >= (max * fps as f64) as usize {
                break;
            }
        }
    }

    child.wait().ok();
    (frames, src_w, src_h)
}
```

**Important notes about ffmpeg piping:**
- Use `-f rawvideo -pix_fmt rgba pipe:1` to get raw RGBA on stdout
- Each frame is exactly `width × height × 4` bytes
- Read frames in a loop with `read_exact` until EOF
- Suppress ffmpeg's stderr banner with `Stdio::null()` or `Stdio::piped()` (if you want to capture errors)
- The `-t` flag limits duration: `-t 20` for 20 seconds max
- The `-vf fps=N` filter controls frame rate extraction

### Step 3: Wire it together

```rust
fn main() {
    let cli = Cli::parse();

    let preset = match cli.preset.as_str() {
        "quality" => Preset::Quality,
        _ => Preset::Balanced,
    };

    // Set thread count if specified
    if let Some(threads) = cli.threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global()
            .ok();
    }

    if !cli.quiet {
        eprintln!("Extracting frames from {}...", cli.input);
    }

    let (raw_frames, src_w, src_h) = extract_frames(&cli.input, cli.fps, cli.max_duration);

    if !cli.quiet {
        eprintln!("Extracted {} frames ({}×{})", raw_frames.len(), src_w, src_h);
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
        eprintln!("Encoding {} frames...", frames.len());
    }

    let start = std::time::Instant::now();
    let gif = encode_parallel(&frames, &opts);
    let elapsed = start.elapsed();

    std::fs::write(&cli.output, &gif).expect("failed to write output file");

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
```

### Step 4: Test the CLI

```bash
# Build
cd packages/gifhero-core
cargo build --release --features cli

# Test with a video file
./target/release/gifhero test/fixtures/videos/some-video.mp4 -w 480 --fps 20 -o test-output.gif

# Test with duration limit
./target/release/gifhero input.mp4 -w 480 --fps 15 --max-duration 10 -o short.gif

# Test with quality preset
./target/release/gifhero input.mp4 -w 480 --preset quality -o quality.gif

# Test error cases
./target/release/gifhero nonexistent.mp4  # should error gracefully
```

If there are no video files in test/fixtures/videos/, create a synthetic test video with ffmpeg:
```bash
ffmpeg -f lavfi -i testsrc2=duration=5:size=1920x1080:rate=30 -c:v libx264 -pix_fmt yuv420p test-video.mp4
```

### Step 5: Compare CLI output against encode_test example

To verify the CLI produces the same output as the library:
1. Extract frames manually with ffmpeg to a PNG directory
2. Run encode_test example on those PNGs
3. Run the CLI on the original video with the same fps/width
4. Compare file sizes — should be within ±1% (minor differences from ffmpeg's frame extraction vs PNG decode)

### Step 6: Add a help message and version

Make sure `gifhero --help` and `gifhero --version` work:
```
gifhero 0.1.0 — high-quality GIF encoder

Usage: gifhero [OPTIONS] <INPUT>

Arguments:
  <INPUT>  Input video file (any format ffmpeg supports)

Options:
  -o, --output <PATH>      Output GIF path [default: output.gif]
  -w, --width <PX>         Target width (height auto from aspect ratio)
      --height <PX>        Target height
      --fps <N>            Frames per second [default: 20]
      --preset <NAME>      quality | balanced [default: balanced]
      --max-duration <S>   Maximum duration in seconds
  -j, --threads <N>        Worker threads [default: all cores]
  -q, --quiet              Suppress progress output
  -h, --help               Print help
  -V, --version            Print version
```

## What NOT to do

- Don't set up WASM exports — that's Phase 6.
- Don't modify the library code (`lib.rs`, `probe.rs`, etc.) — only modify `main.rs`.
- Don't modify existing TypeScript code.
- Don't implement a progress bar (nice to have but not required — a simple stderr message per phase is enough).
- Don't bundle ffmpeg — assume it's installed on the system PATH.

## Files to create/modify

```
packages/gifhero-core/src/
└── main.rs          ← full CLI implementation (replace the TODO stub)
```

## Reference files to read

1. `RUST-PORT-PLAN.md` — CLI design section
2. `packages/gifhero-core/src/lib.rs` — encode() and encode_parallel() signatures
3. `packages/gifhero-core/Cargo.toml` — verify clap is in cli feature deps
4. `packages/gifhero-core/examples/encode_test.rs` — reference for how to call encode
