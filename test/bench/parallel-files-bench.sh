#!/bin/bash
# Benchmark: encoding N files in parallel
# Tests throughput scaling from 1 to 16 concurrent encodes

ENCODE_TEST="packages/gifhero-core/target/release/examples/encode_test"
FIXTURES_DIR="test/fixtures/generated"
OUT_DIR="/tmp/gifhero-parallel-bench"
mkdir -p "$OUT_DIR"

# Use 16 diverse fixtures
FIXTURES=(
  bbb-clip-01 bbb-clip-02 bbb-clip-03 bbb-clip-04
  bbb-clip-05 bbb-clip-06 bbb-clip-07 bbb-clip-08
  bbb-clip-09 bbb-clip-10 big-buck-bunny candle-flame
  city-night fast-action jellyfish talking-head
)

# First: measure single-file encode time (baseline)
echo "=== Single file baseline ==="
START=$(python3 -c 'import time; print(time.time())')
"$ENCODE_TEST" "$FIXTURES_DIR/bbb-clip-01" "$OUT_DIR/baseline.gif" --single 2>/dev/null
END=$(python3 -c 'import time; print(time.time())')
SINGLE=$(python3 -c "print(f'{$END - $START:.2f}')")
echo "1 file, 1 thread: ${SINGLE}s"
echo ""

# Test N concurrent encodes, each with RAYON_NUM_THREADS=floor(16/N)
echo "=== Parallel file encoding (16 cores total) ==="
echo "N files | Threads/file | Wall time | Throughput (files/s) | vs sequential"
echo "--------|--------------|-----------|----------------------|--------------"

for N in 1 2 4 8 16; do
  THREADS=$((16 / N))
  if [ $THREADS -lt 1 ]; then THREADS=1; fi

  START=$(python3 -c 'import time; print(time.time())')

  # Launch N encodes in parallel
  PIDS=()
  for i in $(seq 0 $((N - 1))); do
    FIX=${FIXTURES[$i]}
    RAYON_NUM_THREADS=$THREADS "$ENCODE_TEST" "$FIXTURES_DIR/$FIX" "$OUT_DIR/par-${N}-${FIX}.gif" 2>/dev/null &
    PIDS+=($!)
  done

  # Wait for all
  for PID in "${PIDS[@]}"; do
    wait $PID
  done

  END=$(python3 -c 'import time; print(time.time())')
  WALL=$(python3 -c "print(f'{$END - $START:.2f}')")
  THROUGHPUT=$(python3 -c "print(f'{$N / ($END - $START):.2f}')")
  SEQ_TIME=$(python3 -c "print(f'{$SINGLE * $N:.1f}')")
  SPEEDUP=$(python3 -c "print(f'{$SINGLE * $N / ($END - $START):.1f}')")

  echo "${N}       | ${THREADS}            | ${WALL}s     | ${THROUGHPUT} files/s        | ${SPEEDUP}x vs ${SEQ_TIME}s seq"
done

echo ""
echo "=== Cleanup ==="
rm -rf "$OUT_DIR"
echo "Done."
