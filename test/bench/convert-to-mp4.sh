#!/bin/bash
# Convert all benchmark GIFs to H.265 444p 10-bit MP4 for the A/B viewer.
# Runs 4 conversions in parallel. Skips files already converted.

set -euo pipefail

GIFS_DIR="$(dirname "$0")/results/gifs"
MP4_DIR="$(dirname "$0")/results/mp4"
JOBS=4

mkdir -p "$MP4_DIR"

convert_one() {
  local gif="$1"
  local name
  name=$(basename "$gif" .gif)
  local mp4="${MP4_DIR}/${name}.mp4"

  if [ -f "$mp4" ]; then
    return 0
  fi

  ffmpeg -y -i "$gif" \
    -r 20 \
    -c:v libx265 -crf 18 -g 1 -preset fast \
    -pix_fmt yuv444p10le \
    -movflags +faststart \
    -tag:v hvc1 \
    -an \
    "$mp4" 2>/dev/null

  local sz
  sz=$(stat -f%z "$mp4" 2>/dev/null || stat -c%s "$mp4" 2>/dev/null)
  echo "  ${name}: $((sz / 1024)) KB"
}

export -f convert_one
export MP4_DIR

total=$(find "$GIFS_DIR" -name '*.gif' | wc -l | tr -d ' ')
existing=$(find "$MP4_DIR" -name '*.mp4' 2>/dev/null | wc -l | tr -d ' ')
todo=$((total - existing))

echo "GIFs: ${total}, already converted: ${existing}, to convert: ${todo}"
echo "Settings: H.265 CRF 18, yuv444p10le, all-intra, 20fps"
echo "Parallel: ${JOBS} jobs"
echo ""

find "$GIFS_DIR" -name '*.gif' -print0 | xargs -0 -P "$JOBS" -I {} bash -c 'convert_one "$@"' _ {}

mp4_total=$(du -sh "$MP4_DIR" 2>/dev/null | cut -f1)
echo ""
echo "Done. Total MP4 size: ${mp4_total}"
