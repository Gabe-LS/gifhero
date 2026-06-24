/**
 * Pre-encode frame analysis.
 *
 * Scans all source frames to build a content profile that guides
 * encoding decisions. Runs before any quantization or dithering,
 * so it is pure RGB arithmetic — fast even on 60+ frame clips.
 *
 * @module
 */

export interface ProbeResult {
  /** Per-pixel flag: 1 = pixel never changes across all frames. */
  staticMask: Uint8Array;

  /** Fraction of pixels that are static (0–1). */
  staticFraction: number;

  /** Average fraction of pixels that change per frame (0–1). */
  motionLevel: number;

  /** Distinct colors in sampled frames (6-bit-per-channel quantized). */
  colorComplexity: number;

  /** Frame indices where > 60% of pixels change at once. */
  sceneChanges: number[];

  /** Per-frame fraction of pixels that changed vs previous frame. */
  perFrameMotion: number[];
}

/**
 * Analyze source frames to build a content profile.
 *
 * @param frames - RGBA pixel data for each frame
 * @param width - Frame width in pixels
 * @param height - Frame height in pixels
 * @param tolerance - Max per-channel range for a pixel to be considered static
 * @returns Content profile used by the encoder
 */
export function probeFrames(
  frames: Uint8ClampedArray[],
  width: number,
  height: number,
  tolerance: number = 3,
): ProbeResult {
  const numPixels = width * height;

  // ── Static mask via per-pixel min/max tracking ──

  const minR = new Uint8Array(numPixels).fill(255);
  const maxR = new Uint8Array(numPixels).fill(0);
  const minG = new Uint8Array(numPixels).fill(255);
  const maxG = new Uint8Array(numPixels).fill(0);
  const minB = new Uint8Array(numPixels).fill(255);
  const maxB = new Uint8Array(numPixels).fill(0);

  for (const frame of frames) {
    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      const r = frame[idx], g = frame[idx + 1], b = frame[idx + 2];
      if (r < minR[i]) minR[i] = r;
      if (r > maxR[i]) maxR[i] = r;
      if (g < minG[i]) minG[i] = g;
      if (g > maxG[i]) maxG[i] = g;
      if (b < minB[i]) minB[i] = b;
      if (b > maxB[i]) maxB[i] = b;
    }
  }

  const staticMask = new Uint8Array(numPixels);
  let staticCount = 0;
  for (let i = 0; i < numPixels; i++) {
    if (maxR[i] - minR[i] <= tolerance &&
        maxG[i] - minG[i] <= tolerance &&
        maxB[i] - minB[i] <= tolerance) {
      staticMask[i] = 1;
      staticCount++;
    }
  }
  const staticFraction = staticCount / numPixels;

  // ── Per-frame motion ──

  const perFrameMotion: number[] = [0];
  let totalMotion = 0;
  for (let f = 1; f < frames.length; f++) {
    let changed = 0;
    const curr = frames[f];
    const prev = frames[f - 1];
    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      const d = Math.max(
        Math.abs(curr[idx] - prev[idx]),
        Math.abs(curr[idx + 1] - prev[idx + 1]),
        Math.abs(curr[idx + 2] - prev[idx + 2]),
      );
      if (d > 5) changed++;
    }
    const fraction = changed / numPixels;
    perFrameMotion.push(fraction);
    totalMotion += fraction;
  }
  const motionLevel = frames.length > 1 ? totalMotion / (frames.length - 1) : 0;

  // ── Color complexity (sample every 5th frame, 6-bit quantized) ──

  const colorSet = new Set<number>();
  for (let f = 0; f < frames.length; f += 5) {
    const frame = frames[f];
    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      const r6 = frame[idx] >> 2;
      const g6 = frame[idx + 1] >> 2;
      const b6 = frame[idx + 2] >> 2;
      colorSet.add((r6 << 12) | (g6 << 6) | b6);
    }
  }

  // ── Scene changes + keyframes ──
  // A keyframe is needed at scene changes (>60% pixels change) and
  // at motion-to-static transitions (high-motion frame followed by
  // low-motion frames — the canvas carries stale quantization error).

  const sceneThreshold = 0.6;
  const sceneChanges: number[] = [];
  for (let f = 1; f < frames.length; f++) {
    if (perFrameMotion[f] > sceneThreshold) {
      sceneChanges.push(f);
    } else if (f >= 2 && perFrameMotion[f] < 0.02 && perFrameMotion[f - 1] > 0.15) {
      sceneChanges.push(f);
    }
  }

  return {
    staticMask,
    staticFraction,
    motionLevel,
    colorComplexity: colorSet.size,
    sceneChanges,
    perFrameMotion,
  };
}

/**
 * Incremental probe that processes one frame at a time.
 *
 * Same algorithm as probeFrames() but split across addFrame() calls.
 * Use for streaming pipelines where frames arrive sequentially and
 * holding all frames in memory is not feasible.
 */
export class IncrementalProbe {
  private numPixels: number;
  private tolerance: number;
  private minR: Uint8Array;
  private maxR: Uint8Array;
  private minG: Uint8Array;
  private maxG: Uint8Array;
  private minB: Uint8Array;
  private maxB: Uint8Array;
  private prevFrame: Uint8ClampedArray | null = null;
  private perFrameMotion: number[] = [];
  private totalMotion = 0;
  private colorSet = new Set<number>();
  private frameCount = 0;

  constructor(
    private width: number,
    private height: number,
    tolerance: number = 3,
  ) {
    this.numPixels = width * height;
    this.tolerance = tolerance;
    this.minR = new Uint8Array(this.numPixels).fill(255);
    this.maxR = new Uint8Array(this.numPixels).fill(0);
    this.minG = new Uint8Array(this.numPixels).fill(255);
    this.maxG = new Uint8Array(this.numPixels).fill(0);
    this.minB = new Uint8Array(this.numPixels).fill(255);
    this.maxB = new Uint8Array(this.numPixels).fill(0);
  }

  /** Feed one frame to the probe. Frames must arrive in order. */
  addFrame(data: Uint8ClampedArray): void {
    const np = this.numPixels;

    for (let i = 0; i < np; i++) {
      const idx = i * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (r < this.minR[i]) this.minR[i] = r;
      if (r > this.maxR[i]) this.maxR[i] = r;
      if (g < this.minG[i]) this.minG[i] = g;
      if (g > this.maxG[i]) this.maxG[i] = g;
      if (b < this.minB[i]) this.minB[i] = b;
      if (b > this.maxB[i]) this.maxB[i] = b;
    }

    if (this.prevFrame) {
      let changed = 0;
      for (let i = 0; i < np; i++) {
        const idx = i * 4;
        const d = Math.max(
          Math.abs(data[idx] - this.prevFrame[idx]),
          Math.abs(data[idx + 1] - this.prevFrame[idx + 1]),
          Math.abs(data[idx + 2] - this.prevFrame[idx + 2]),
        );
        if (d > 5) changed++;
      }
      const fraction = changed / np;
      this.perFrameMotion.push(fraction);
      this.totalMotion += fraction;
    } else {
      this.perFrameMotion.push(0);
    }

    if (this.frameCount % 5 === 0) {
      for (let i = 0; i < np; i++) {
        const idx = i * 4;
        this.colorSet.add(
          ((data[idx] >> 2) << 12) | ((data[idx + 1] >> 2) << 6) | (data[idx + 2] >> 2),
        );
      }
    }

    this.prevFrame = data;
    this.frameCount++;
  }

  /** Finalize and return the probe result. */
  finalize(): ProbeResult {
    const np = this.numPixels;
    const staticMask = new Uint8Array(np);
    let staticCount = 0;
    for (let i = 0; i < np; i++) {
      if (this.maxR[i] - this.minR[i] <= this.tolerance &&
          this.maxG[i] - this.minG[i] <= this.tolerance &&
          this.maxB[i] - this.minB[i] <= this.tolerance) {
        staticMask[i] = 1;
        staticCount++;
      }
    }

    const motionLevel = this.frameCount > 1
      ? this.totalMotion / (this.frameCount - 1)
      : 0;

    const sceneThreshold = 0.6;
    const sceneChanges: number[] = [];
    for (let f = 1; f < this.perFrameMotion.length; f++) {
      if (this.perFrameMotion[f] > sceneThreshold) {
        sceneChanges.push(f);
      } else if (f >= 2 && this.perFrameMotion[f] < 0.02 && this.perFrameMotion[f - 1] > 0.15) {
        sceneChanges.push(f);
      }
    }

    return {
      staticMask,
      staticFraction: staticCount / np,
      motionLevel,
      colorComplexity: this.colorSet.size,
      sceneChanges,
      perFrameMotion: this.perFrameMotion,
    };
  }
}
