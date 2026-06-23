/**
 * High-quality image downscaling and adaptive sharpening.
 *
 * Uses Lanczos3 resampling (sinc-windowed sinc) for downscaling —
 * the same algorithm used by libswscale, Photoshop, and ImageMagick
 * for high-quality size reduction. Pure RGBA arithmetic, no DOM.
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
  const tmp = new Float32Array(dstW * srcH * 4);
  const xRatio = srcW / dstW;
  const xRadius = Math.max(3, Math.ceil(3 * xRatio));

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < dstW; x++) {
      const center = (x + 0.5) * xRatio - 0.5;
      let r = 0, g = 0, b = 0, a = 0, wSum = 0;

      for (let k = Math.max(0, Math.floor(center) - xRadius + 1);
           k <= Math.min(srcW - 1, Math.ceil(center) + xRadius - 1); k++) {
        const w = lanczos3((k - center) / xRatio * 3 / xRadius);
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
  const yRatio = srcH / dstH;
  const yRadius = Math.max(3, Math.ceil(3 * yRatio));

  for (let x = 0; x < dstW; x++) {
    for (let y = 0; y < dstH; y++) {
      const center = (y + 0.5) * yRatio - 0.5;
      let r = 0, g = 0, b = 0, a = 0, wSum = 0;

      for (let k = Math.max(0, Math.floor(center) - yRadius + 1);
           k <= Math.min(srcH - 1, Math.ceil(center) + yRadius - 1); k++) {
        const w = lanczos3((k - center) / yRatio * 3 / yRadius);
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

// ── Adaptive unsharp mask ───────────────────────────────────────

/**
 * Apply adaptive unsharp mask sharpening.
 *
 * Automatically scales the sharpening parameters based on the
 * downscale ratio: more aggressive sharpening for larger reductions
 * to compensate for detail loss during resampling.
 *
 * @param rgba - RGBA pixel data (modified in place)
 * @param width - Image width
 * @param height - Image height
 * @param downscaleRatio - Ratio of original size to current size (e.g. 2.0 for 50% downscale)
 * @param strength - Override sharpening strength (0-1). Auto-scaled from downscaleRatio if omitted.
 */
export function adaptiveSharpen(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  downscaleRatio: number,
  strength?: number,
): void {
  // Auto-scale: more downscaling → more sharpening
  // ratio 1.0 → amount 0 (no sharpening needed)
  // ratio 1.5 → amount ~0.3
  // ratio 2.0 → amount ~0.5
  // ratio 3.0 → amount ~0.7
  // ratio 4.0+ → amount ~0.8 (cap)
  const amount = strength ?? Math.min(0.5, Math.max(0, (downscaleRatio - 1) * 0.15));
  if (amount < 0.01) return;

  // Radius scales with ratio too: small downscale → tight radius,
  // large downscale → wider radius to catch coarser detail loss.
  const radius = downscaleRatio <= 2 ? 1 : 2;

  // Build Gaussian blur kernel
  const size = radius * 2 + 1;
  const sigma = radius * 0.65;
  const kernel = new Float32Array(size * size);
  let kSum = 0;
  for (let ky = -radius; ky <= radius; ky++) {
    for (let kx = -radius; kx <= radius; kx++) {
      const v = Math.exp(-(kx * kx + ky * ky) / (2 * sigma * sigma));
      kernel[(ky + radius) * size + (kx + radius)] = v;
      kSum += v;
    }
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  // Blur the image
  const blurred = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const sy = Math.max(0, Math.min(height - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const sx = Math.max(0, Math.min(width - 1, x + kx));
          const w = kernel[(ky + radius) * size + (kx + radius)];
          const si = (sy * width + sx) * 4;
          r += rgba[si] * w;
          g += rgba[si + 1] * w;
          b += rgba[si + 2] * w;
        }
      }
      const di = (y * width + x) * 3;
      blurred[di] = r;
      blurred[di + 1] = g;
      blurred[di + 2] = b;
    }
  }

  // Unsharp mask: original + amount * (original - blurred)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const bi = (y * width + x) * 3;
      rgba[pi] = Math.max(0, Math.min(255,
        Math.round(rgba[pi] + amount * (rgba[pi] - blurred[bi]))));
      rgba[pi + 1] = Math.max(0, Math.min(255,
        Math.round(rgba[pi + 1] + amount * (rgba[pi + 1] - blurred[bi + 1]))));
      rgba[pi + 2] = Math.max(0, Math.min(255,
        Math.round(rgba[pi + 2] + amount * (rgba[pi + 2] - blurred[bi + 2]))));
    }
  }
}

/**
 * Downscale and optionally sharpen RGBA frames.
 *
 * @param frames - Source RGBA frames
 * @param srcW - Source width
 * @param srcH - Source height
 * @param dstW - Target width
 * @param dstH - Target height (auto-calculated from aspect ratio if omitted)
 * @param sharpen - Apply adaptive sharpening after downscale. Default true.
 * @returns Downscaled frames with new dimensions
 */
export function resizeFrames(
  frames: Array<{ data: Uint8ClampedArray; delay?: number }>,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH?: number,
  sharpen: boolean = false,
): { width: number; height: number; frames: Array<{ data: Uint8ClampedArray; delay?: number }> } {
  const h = dstH ?? Math.round(srcH * (dstW / srcW));
  const ratio = srcW / dstW;

  const resized = frames.map((f) => {
    const scaled = downsample(f.data, srcW, srcH, dstW, h);
    if (sharpen && ratio > 1.05) {
      adaptiveSharpen(scaled, dstW, h, ratio);
    }
    return { data: scaled, delay: f.delay };
  });

  return { width: dstW, height: h, frames: resized };
}
