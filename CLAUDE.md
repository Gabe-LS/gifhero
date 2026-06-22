# gifhero

## What This Is
A TypeScript GIF encoding library targeting the browser (Chrome extensions, web apps).
Goal: gifski-level quality in pure JS/WASM. See ARCHITECTURE.md for full technical spec.

## Tech Stack
- TypeScript (strict mode), targeting ES2020
- Build: tsup (ESM + CJS dual output)
- Test: vitest
- No runtime dependencies (WASM quantizer is an optional peer dep)

## Conventions
- Pure functions where possible. No classes unless managing stateful resources (workers, WASM instances).
- All pixel data as Uint8Array or Uint8ClampedArray.
- Every public function has JSDoc with @param and @returns.
- Error messages must be actionable ("Frame 3 has 0 pixels — did you pass an empty canvas?" not "Invalid input").
- Never mutate input data. Clone if needed.

## Architecture
Read ARCHITECTURE.md before touching src/. The library has 4 layers:
1. Quantizers (src/quantizers/) — color reduction algorithms
2. Dithering (src/dither/) — spatial and temporal error diffusion
3. Optimization (src/optimize/) — frame diff, disposal, palette strategy
4. Encoder (src/encoder/) — GIF89a binary writer + LZW

## Commands
- `npm run build` — build with tsup
- `npm run test` — run vitest
- `npm run bench` — run benchmarks in test/bench/

## Current Phase
Phase 1: Foundation. Working on GIF89a writer, NeuQuant, Floyd-Steinberg, basic worker support.
