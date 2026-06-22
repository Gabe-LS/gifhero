/**
 * Temporal Flicker Score (TFS)
 *
 * Measures how much the GIF "shimmers" in areas that should be static.
 * Standard dithering treats each frame independently, which causes the same
 * pixel to bounce between palette entries even when the source didn't change.
 * Temporal dithering fixes this. This metric quantifies the difference.
 *
 * Score: 0.0 = no flicker (perfect), 1.0 = maximum flicker
 * Good GIFs: < 0.03, Acceptable: < 0.08, Bad: > 0.15
 */

export interface FlickerResult {
  /** Overall flicker score 0.0–1.0 */
  score: number;
  /** Number of pixels that flickered without source change */
  flickerPixels: number;
  /** Total pixel-pair comparisons made */
  totalComparisons: number;
  /** Per-frame flicker scores */
  perFrame: number[];
  /** Flicker heatmap: how many times each pixel flickered (flat array, width × height) */
  heatmap: Uint32Array;
}

/**
 * Compare source frames against encoded frames to detect temporal flicker.
 *
 * @param sourceFrames - Array of RGBA Uint8ClampedArray from original images
 * @param encodedFrames - Array of RGBA Uint8ClampedArray from GIF frames
 * @param width - Frame width in pixels
 * @param height - Frame height in pixels
 * @param sourceThreshold - Max RGB distance to consider source pixel "unchanged" (default: 5)
 * @param encodedThreshold - Min RGB distance to count as a "flicker" in output (default: 10)
 */
export function computeFlickerScore(
  sourceFrames: Uint8ClampedArray[],
  encodedFrames: Uint8ClampedArray[],
  width: number,
  height: number,
  sourceThreshold = 5,
  encodedThreshold = 10
): FlickerResult {
  if (sourceFrames.length !== encodedFrames.length) {
    throw new Error(
      `Frame count mismatch: ${sourceFrames.length} source vs ${encodedFrames.length} encoded`
    );
  }

  if (sourceFrames.length < 2) {
    return {
      score: 0,
      flickerPixels: 0,
      totalComparisons: 0,
      perFrame: [],
      heatmap: new Uint32Array(width * height),
    };
  }

  const pixelCount = width * height;
  const frameCount = sourceFrames.length;
  const heatmap = new Uint32Array(pixelCount);
  const perFrame: number[] = [];

  let totalFlicker = 0;
  let totalComparisons = 0;

  for (let f = 1; f < frameCount; f++) {
    const srcPrev = sourceFrames[f - 1];
    const srcCurr = sourceFrames[f];
    const encPrev = encodedFrames[f - 1];
    const encCurr = encodedFrames[f];

    let frameFlicker = 0;
    let frameComparisons = 0;

    for (let p = 0; p < pixelCount; p++) {
      const i = p * 4; // RGBA offset

      // Source pixel difference between frames
      const srcDiffR = Math.abs(srcCurr[i] - srcPrev[i]);
      const srcDiffG = Math.abs(srcCurr[i + 1] - srcPrev[i + 1]);
      const srcDiffB = Math.abs(srcCurr[i + 2] - srcPrev[i + 2]);
      const srcDist = Math.max(srcDiffR, srcDiffG, srcDiffB);

      // Only check pixels where the source didn't meaningfully change
      if (srcDist <= sourceThreshold) {
        frameComparisons++;

        // Encoded pixel difference between frames
        const encDiffR = Math.abs(encCurr[i] - encPrev[i]);
        const encDiffG = Math.abs(encCurr[i + 1] - encPrev[i + 1]);
        const encDiffB = Math.abs(encCurr[i + 2] - encPrev[i + 2]);
        const encDist = Math.max(encDiffR, encDiffG, encDiffB);

        // Source was stable but encoded pixel jumped — that's flicker
        if (encDist > encodedThreshold) {
          frameFlicker++;
          heatmap[p]++;
        }
      }
    }

    totalFlicker += frameFlicker;
    totalComparisons += frameComparisons;
    perFrame.push(frameComparisons > 0 ? frameFlicker / frameComparisons : 0);
  }

  return {
    score: totalComparisons > 0 ? totalFlicker / totalComparisons : 0,
    flickerPixels: totalFlicker,
    totalComparisons,
    perFrame,
    heatmap,
  };
}

/**
 * Render a flicker heatmap as an RGBA image.
 * Red intensity = flicker frequency at that pixel.
 */
export function renderFlickerHeatmap(
  heatmap: Uint32Array,
  width: number,
  height: number,
  maxFrames: number
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const maxVal = Math.max(1, ...heatmap);

  for (let p = 0; p < width * height; p++) {
    const intensity = Math.min(255, Math.floor((heatmap[p] / maxVal) * 255));
    const i = p * 4;
    rgba[i] = intensity;       // R — flicker intensity
    rgba[i + 1] = 0;           // G
    rgba[i + 2] = 255 - intensity; // B — stable areas
    rgba[i + 3] = 255;         // A
  }

  return rgba;
}
