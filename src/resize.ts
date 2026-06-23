/**
 * High-quality image downscaling via Lanczos3 resampling.
 *
 * Uses sinc-windowed sinc (Lanczos3) — the same algorithm used by
 * libswscale, Photoshop, and ImageMagick for high-quality size
 * reduction. Pure RGBA arithmetic, no DOM.
 *
 * @module
 */

// ── Lanczos kernel ──────────────────────────────────────────────

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczos3(x: number): number {
  if (x < 0) x = -x;
  if (x >= 3) return 0;
  return sinc(x) * sinc(x / 3);
}

// ── Lanczos3 downscale ──────────────────────────────────────────

/**
 * Downscale an RGBA image using Lanczos3 resampling.
 *
 * Two-pass separable filter: horizontal then vertical.
 * Handles non-premultiplied alpha correctly.
 *
 * @param src - Source RGBA pixel data
 * @param srcW - Source width
 * @param srcH - Source height
 * @param dstW - Destination width
 * @param dstH - Destination height
 * @returns Downscaled RGBA pixel data
 */
export function downsample(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  if (dstW >= srcW && dstH >= srcH) {
    return new Uint8ClampedArray(src);
  }

  // Horizontal pass: srcW×srcH → dstW×srcH
  // For downscaling, the Lanczos3 kernel is stretched by the ratio
  // so each output pixel samples a proportionally wider input area.
  const tmp = new Float32Array(dstW * srcH * 4);
  const xScale = Math.max(1, srcW / dstW);
  const xSupport = Math.ceil(3 * xScale);

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < dstW; x++) {
      const center = (x + 0.5) * (srcW / dstW) - 0.5;
      let r = 0, g = 0, b = 0, a = 0, wSum = 0;

      const kMin = Math.max(0, Math.floor(center - xSupport));
      const kMax = Math.min(srcW - 1, Math.ceil(center + xSupport));
      for (let k = kMin; k <= kMax; k++) {
        const w = lanczos3((k - center) / xScale);
        const si = (y * srcW + k) * 4;
        const sa = src[si + 3] / 255;
        r += src[si] * sa * w;
        g += src[si + 1] * sa * w;
        b += src[si + 2] * sa * w;
        a += sa * w;
        wSum += w;
      }

      const di = (y * dstW + x) * 4;
      if (a > 0.001) {
        tmp[di] = r / a;
        tmp[di + 1] = g / a;
        tmp[di + 2] = b / a;
        tmp[di + 3] = (a / wSum) * 255;
      }
    }
  }

  // Vertical pass: dstW×srcH → dstW×dstH
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const yScale = Math.max(1, srcH / dstH);
  const ySupport = Math.ceil(3 * yScale);

  for (let x = 0; x < dstW; x++) {
    for (let y = 0; y < dstH; y++) {
      const center = (y + 0.5) * (srcH / dstH) - 0.5;
      let r = 0, g = 0, b = 0, a = 0, wSum = 0;

      const kMin = Math.max(0, Math.floor(center - ySupport));
      const kMax = Math.min(srcH - 1, Math.ceil(center + ySupport));
      for (let k = kMin; k <= kMax; k++) {
        const w = lanczos3((k - center) / yScale);
        const si = (k * dstW + x) * 4;
        const sa = tmp[si + 3] / 255;
        r += tmp[si] * sa * w;
        g += tmp[si + 1] * sa * w;
        b += tmp[si + 2] * sa * w;
        a += sa * w;
        wSum += w;
      }

      const di = (y * dstW + x) * 4;
      if (a > 0.001) {
        dst[di] = Math.round(Math.max(0, Math.min(255, r / a)));
        dst[di + 1] = Math.round(Math.max(0, Math.min(255, g / a)));
        dst[di + 2] = Math.round(Math.max(0, Math.min(255, b / a)));
        dst[di + 3] = Math.round(Math.max(0, Math.min(255, a / wSum * 255)));
      }
    }
  }

  return dst;
}

/**
 * Downscale RGBA frames using Lanczos3 resampling.
 *
 * @param frames - Source RGBA frames
 * @param srcW - Source width
 * @param srcH - Source height
 * @param dstW - Target width
 * @param dstH - Target height (auto-calculated from aspect ratio if omitted)
 * @returns Downscaled frames with new dimensions
 */
export function resizeFrames(
  frames: Array<{ data: Uint8ClampedArray; delay?: number }>,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH?: number,
): { width: number; height: number; frames: Array<{ data: Uint8ClampedArray; delay?: number }> } {
  const h = dstH ?? Math.floor(srcH * (dstW / srcW));

  const resized = frames.map((f) => ({
    data: downsample(f.data, srcW, srcH, dstW, h),
    delay: f.delay,
  }));

  return { width: dstW, height: h, frames: resized };
}
