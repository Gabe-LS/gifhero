#!/usr/bin/env bash
#
# gifhero benchmark setup
# Downloads open-source test clips, extracts frame sequences,
# and verifies required tools are installed.
#
# Usage: npm run bench:setup   (or: bash scripts/bench-setup.sh)

set -euo pipefail

FIXTURES_DIR="test/fixtures/generated"
VIDEO_DIR="test/fixtures/videos"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

# ─────────────────────────────────────────────
# 1. Check required tools
# ─────────────────────────────────────────────
echo ""
echo "━━━ Checking required tools ━━━"
echo ""

TOOLS_OK=true

check_tool() {
  if command -v "$1" &> /dev/null; then
    ok "$1 found: $(command -v "$1")"
  else
    fail "$1 not found"
    echo "    Install: $2"
    TOOLS_OK=false
  fi
}

check_tool "ffmpeg"   "brew install ffmpeg"
check_tool "gifski"   "brew install gifski"
check_tool "gifsicle" "brew install gifsicle"
check_tool "dssim"    "brew install dssim  (or: cargo install dssim)"
check_tool "node"     "https://nodejs.org"
check_tool "npx"      "comes with node/npm"
check_tool "yt-dlp"   "pip install yt-dlp"

echo ""
if [ "$TOOLS_OK" = false ]; then
  warn "Some tools are missing. Benchmark will skip comparisons for unavailable encoders."
  echo "    Run: brew install ffmpeg gifski gifsicle dssim"
  echo ""
fi

# ─────────────────────────────────────────────
# 2. Generate programmatic fixtures
# ─────────────────────────────────────────────
echo "━━━ Generating programmatic fixtures ━━━"
echo ""

# Install canvas dependency if needed
if ! node -e "require('canvas')" 2>/dev/null; then
  echo "Installing canvas dependency..."
  npm install --save-dev canvas 2>/dev/null || {
    warn "Could not install 'canvas'. Skipping programmatic fixture generation."
    warn "Run: npm install --save-dev canvas"
  }
fi

npx tsx test/fixtures/generate.ts || {
  warn "Programmatic fixture generation failed. Install deps: npm install --save-dev canvas"
}

# ─────────────────────────────────────────────
# 3. Download open-source video clips
# ─────────────────────────────────────────────
echo ""
echo "━━━ Downloading test video clips ━━━"
echo ""

mkdir -p "$VIDEO_DIR"

download_clip() {
  local name="$1"
  local url="$2"
  local file="$VIDEO_DIR/$name.mp4"

  if [ -f "$file" ]; then
    ok "$name already downloaded"
    return
  fi

  echo "  Downloading $name..."
  curl -L --progress-bar -o "$file" "$url" && ok "$name downloaded" || {
    fail "Could not download $name"
    return 1
  }
}

# Big Buck Bunny — 720p, 10 seconds starting at 00:30 (action scene)
# We download the full clip and extract a segment
BBB_URL="https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4"
download_clip "big-buck-bunny" "$BBB_URL" || true

# Sintel trailer — cinematic, skin tones, dark scenes
SINTEL_URL="https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4"
download_clip "sintel" "$SINTEL_URL" || true

# Jellyfish — underwater, smooth gradients, blue tones
JELLY_URL="https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4"
download_clip "jellyfish" "$JELLY_URL" || true

# ─────────────────────────────────────────────
# 3b. Download YouTube clips via yt-dlp
# ─────────────────────────────────────────────
echo ""
echo "━━━ Downloading YouTube clips ━━━"
echo ""

download_youtube() {
  local name="$1"
  local url="$2"
  local file="$VIDEO_DIR/$name.mp4"

  if [ -f "$file" ]; then
    ok "$name already downloaded"
    return
  fi

  if ! command -v yt-dlp &> /dev/null; then
    warn "yt-dlp not found — skipping $name"
    return
  fi

  echo "  Downloading $name from YouTube..."
  yt-dlp --download-sections "*5-15" \
    -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" \
    -o "$file" "$url" 2>&1 \
    && ok "$name downloaded" \
    || fail "Could not download $name"
}

# Fast action — high motion, camera movement
download_youtube "fast-action" "https://www.youtube.com/watch?v=kcfs1-ryKWE" || true

# Screen recording — flat colors, sharp text, large static areas
download_youtube "screen-recording" "https://www.youtube.com/watch?v=wcieicCnmXY" || true

# ─────────────────────────────────────────────
# 3c. Link local video files (if present)
# ─────────────────────────────────────────────
echo ""
echo "━━━ Checking local video files ━━━"
echo ""

link_local() {
  local name="$1"
  local src="$2"
  local file="$VIDEO_DIR/$name.mp4"

  if [ -f "$file" ]; then
    ok "$name already present"
    return
  fi

  if [ -f "$src" ]; then
    cp "$src" "$file" && ok "$name copied from local file" || fail "$name copy failed"
  else
    warn "$name: source not found at $src"
  fi
}

# Talking head — skin tones, subtle movement, 4K downscale
link_local "talking-head" "$HOME/Downloads/12691773-uhd_3840_2160_60fps.mp4"

# Candle flame — warm tones, flickering light, dark background
link_local "candle-flame" "$HOME/Downloads/4055408-hd_1920_1080_30fps.mp4"

# City night — neon lights, dark scene, wide color range
link_local "city-night" "$HOME/Downloads/14294707_3840_2160_24fps.mp4"

# Black and white — high contrast, no color, portrait orientation
link_local "black-and-white" "$HOME/Downloads/15472744_2160_3840_50fps.mp4"

# ─────────────────────────────────────────────
# 4. Extract frame sequences from videos
# ─────────────────────────────────────────────
echo ""
echo "━━━ Extracting frame sequences ━━━"
echo ""

extract_frames() {
  local name="$1"
  local video="$VIDEO_DIR/$name.mp4"
  local outdir="$FIXTURES_DIR/$name"

  if [ ! -f "$video" ]; then
    warn "Skipping $name (video not downloaded)"
    return
  fi

  if [ -d "$outdir" ] && [ "$(ls -1 "$outdir"/*.png 2>/dev/null | wc -l)" -ge 50 ]; then
    ok "$name frames already extracted"
    return
  fi

  mkdir -p "$outdir"

  # Extract 60 frames at 20fps, scale to 480px wide
  ffmpeg -y -i "$video" \
    -vf "fps=20,scale=480:-1:flags=lanczos" \
    -frames:v 60 \
    -start_number 1 \
    "$outdir/%04d.png" \
    -loglevel error \
    && ok "$name: 60 frames extracted at 480px wide" \
    || fail "$name: frame extraction failed"
}

extract_frames "big-buck-bunny"
extract_frames "sintel"
extract_frames "jellyfish"
extract_frames "fast-action"
extract_frames "talking-head"
extract_frames "candle-flame"
extract_frames "city-night"
extract_frames "screen-recording"
extract_frames "black-and-white"

# ─────────────────────────────────────────────
# 5. Generate reference GIFs from each encoder
# ─────────────────────────────────────────────
echo ""
echo "━━━ Generating reference GIFs ━━━"
echo ""

REFS_DIR="test/bench/references"
mkdir -p "$REFS_DIR"

generate_refs() {
  local name="$1"
  local frames_dir="$FIXTURES_DIR/$name"

  if [ ! -d "$frames_dir" ] || [ "$(ls -1 "$frames_dir"/*.png 2>/dev/null | wc -l)" -lt 2 ]; then
    warn "Skipping $name (no frames found)"
    return
  fi

  echo "  Encoding $name..."

  # gifski (gold standard)
  if command -v gifski &> /dev/null; then
    if [ ! -f "$REFS_DIR/${name}-gifski.gif" ]; then
      gifski --fps 20 --width 480 --quality 100 \
        -o "$REFS_DIR/${name}-gifski.gif" \
        "$frames_dir"/*.png 2>/dev/null \
        && ok "  gifski → ${name}-gifski.gif" \
        || fail "  gifski failed for $name"
    else
      ok "  gifski reference already exists"
    fi
  fi

  # ffmpeg two-pass palettegen
  if command -v ffmpeg &> /dev/null; then
    if [ ! -f "$REFS_DIR/${name}-ffmpeg.gif" ]; then
      ffmpeg -y -framerate 20 -i "$frames_dir/%04d.png" \
        -vf "palettegen=stats_mode=diff:max_colors=256" \
        "$REFS_DIR/${name}-palette.png" \
        -loglevel error 2>/dev/null

      ffmpeg -y -framerate 20 -i "$frames_dir/%04d.png" \
        -i "$REFS_DIR/${name}-palette.png" \
        -lavfi "paletteuse=dither=floyd_steinberg:diff_mode=rectangle" \
        "$REFS_DIR/${name}-ffmpeg.gif" \
        -loglevel error 2>/dev/null \
        && ok "  ffmpeg → ${name}-ffmpeg.gif" \
        || fail "  ffmpeg failed for $name"

      rm -f "$REFS_DIR/${name}-palette.png"
    else
      ok "  ffmpeg reference already exists"
    fi
  fi

  # gifsicle optimized version of ffmpeg output
  if command -v gifsicle &> /dev/null && [ -f "$REFS_DIR/${name}-ffmpeg.gif" ]; then
    if [ ! -f "$REFS_DIR/${name}-gifsicle.gif" ]; then
      gifsicle -O3 --lossy=80 \
        "$REFS_DIR/${name}-ffmpeg.gif" \
        -o "$REFS_DIR/${name}-gifsicle.gif" 2>/dev/null \
        && ok "  gifsicle → ${name}-gifsicle.gif" \
        || fail "  gifsicle failed for $name"
    else
      ok "  gifsicle reference already exists"
    fi
  fi
}

# Generate refs for all fixture sets that have enough frames
for fixture_dir in "$FIXTURES_DIR"/*/; do
  name=$(basename "$fixture_dir")
  frame_count=$(ls -1 "$fixture_dir"/*.png 2>/dev/null | wc -l)
  if [ "$frame_count" -ge 2 ]; then
    generate_refs "$name"
  fi
done

# ─────────────────────────────────────────────
# 6. Summary
# ─────────────────────────────────────────────
echo ""
echo "━━━ Setup complete ━━━"
echo ""

echo "Fixtures:"
for d in "$FIXTURES_DIR"/*/; do
  name=$(basename "$d")
  count=$(ls -1 "$d"/*.png 2>/dev/null | wc -l)
  echo "  $name: $count frames"
done

echo ""
echo "Reference GIFs:"
for f in "$REFS_DIR"/*.gif; do
  if [ -f "$f" ]; then
    size=$(du -h "$f" | cut -f1)
    echo "  $(basename "$f"): $size"
  fi
done

echo ""
echo "Run benchmarks: npm run bench"
echo ""
