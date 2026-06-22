/**
 * NeuQuant neural-network color quantizer.
 *
 * Learns a 256-color palette from RGBA pixel data using a 1-D
 * Self-Organizing Map. Based on Anthony Dekker's 1994 algorithm
 * as popularized by gif.js.
 *
 * @module
 */

// ── Network constants ────────────────────────────────────────────

const NETSIZE = 256;
const MAXNETPOS = NETSIZE - 1;
const NCYCLES = 100;

const PRIME1 = 499;
const PRIME2 = 491;
const PRIME3 = 487;
const PRIME4 = 503;

// Internal precision: pixel values are shifted left by NETBIASSHIFT
// during training, then shifted back in unbiasnet().
const NETBIASSHIFT = 4;

// Frequency / bias bookkeeping
const INTBIASSHIFT = 16;
const INTBIAS = 1 << INTBIASSHIFT;
const GAMMASHIFT = 10;
const BETASHIFT = 10;
const BETA = INTBIAS >> BETASHIFT;
const BETAGAMMA = INTBIAS << (GAMMASHIFT - BETASHIFT);

// Neighborhood radius
const INITRAD = NETSIZE >> 3;
const RADIUSBIASSHIFT = 6;
const RADIUSBIAS = 1 << RADIUSBIASSHIFT;
const INITRADIUS = INITRAD * RADIUSBIAS;
const RADIUSDEC = 30;

// Learning rate (alpha)
const ALPHABIASSHIFT = 10;
const INITALPHA = 1 << ALPHABIASSHIFT;

// Radpower scaling
const RADBIASSHIFT = 8;
const RADBIAS = 1 << RADBIASSHIFT;
const ALPHARADBSHIFT = ALPHABIASSHIFT + RADBIASSHIFT;
const ALPHARADBIAS = 1 << ALPHARADBSHIFT;

// ── Public API ───────────────────────────────────────────────────

/**
 * Generate a 256-color palette from RGBA pixel data.
 *
 * @param rgba - Source pixels as RGBA (4 bytes per pixel)
 * @param quality - Sampling quality 1–30. Lower samples more pixels
 *   (better palette, slower). Default 10.
 * @returns Flat RGB palette, 768 bytes (256 colors × 3 channels)
 */
export function neuquant(
  rgba: Uint8ClampedArray,
  quality: number = 10,
): Uint8Array {
  const samplefac = Math.max(1, Math.min(30, quality));
  const pixelCount = rgba.length >> 2;

  // ── Initialize network ──
  const net = new Int32Array(NETSIZE * 3);
  const bias = new Int32Array(NETSIZE);
  const freq = new Int32Array(NETSIZE);

  for (let i = 0; i < NETSIZE; i++) {
    const v = ((i << (NETBIASSHIFT + 8)) / NETSIZE) | 0;
    const i3 = i * 3;
    net[i3] = v;
    net[i3 + 1] = v;
    net[i3 + 2] = v;
    freq[i] = (INTBIAS / NETSIZE) | 0;
  }

  // ── Train ──
  learn(net, bias, freq, rgba, pixelCount, samplefac);

  // ── Unbias: shift back to 0-255 ──
  const palette = new Uint8Array(NETSIZE * 3);
  for (let i = 0; i < NETSIZE; i++) {
    const i3 = i * 3;
    for (let c = 0; c < 3; c++) {
      let v = (net[i3 + c] + (1 << (NETBIASSHIFT - 1))) >> NETBIASSHIFT;
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      palette[i3 + c] = v;
    }
  }

  return palette;
}

// ── Training loop ────────────────────────────────────────────────

function learn(
  net: Int32Array,
  bias: Int32Array,
  freq: Int32Array,
  rgba: Uint8ClampedArray,
  pixelCount: number,
  samplefac: number,
): void {
  const samplepixels = (pixelCount / samplefac) | 0;
  const alphadec = 30 + (((samplefac - 1) / 3) | 0);
  let alpha = INITALPHA;
  let radius = INITRADIUS;

  let rad = radius >> RADIUSBIASSHIFT;
  if (rad <= 1) rad = 0;

  const radpower = new Int32Array(INITRAD);
  for (let i = 0; i < rad; i++) {
    radpower[i] = (alpha * (((rad * rad - i * i) * RADBIAS) / (rad * rad))) | 0;
  }

  // Coprime step for pseudo-random pixel sampling
  let step: number;
  if (pixelCount < PRIME4) {
    step = 1;
  } else if (pixelCount % PRIME1 !== 0) {
    step = PRIME1;
  } else if (pixelCount % PRIME2 !== 0) {
    step = PRIME2;
  } else if (pixelCount % PRIME3 !== 0) {
    step = PRIME3;
  } else {
    step = PRIME4;
  }

  const delta = Math.max(1, (samplepixels / NCYCLES) | 0);
  const byteLen = pixelCount << 2;
  let pos = 0;

  for (let i = 0; i < samplepixels; i++) {
    const r = (rgba[pos] & 0xff) << NETBIASSHIFT;
    const g = (rgba[pos + 1] & 0xff) << NETBIASSHIFT;
    const b = (rgba[pos + 2] & 0xff) << NETBIASSHIFT;

    // ── Contest: find biased winner ──
    const bestbiaspos = contest(net, bias, freq, r, g, b);

    // ── Move winner toward sample ──
    alterSingle(net, alpha, bestbiaspos, r, g, b);

    // ── Move neighbors ──
    if (rad > 0) {
      alterNeighbours(net, rad, bestbiaspos, r, g, b, radpower);
    }

    // Advance through pixels
    pos += step << 2;
    if (pos >= byteLen) pos -= byteLen;

    // Decay learning rate & radius
    if ((i + 1) % delta === 0) {
      alpha -= (alpha / alphadec) | 0;
      if (alpha < 1) alpha = 1;
      radius -= (radius / RADIUSDEC) | 0;
      if (radius < 0) radius = 0;
      rad = radius >> RADIUSBIASSHIFT;
      if (rad <= 1) rad = 0;
      for (let j = 0; j < rad; j++) {
        radpower[j] =
          (alpha * (((rad * rad - j * j) * RADBIAS) / (rad * rad))) | 0;
      }
    }
  }
}

// ── Contest ───────────────────────────────────────────────────────
// Find the neuron closest to (r,g,b) in biased distance.
// Also maintains freq/bias bookkeeping for all neurons.

function contest(
  net: Int32Array,
  bias: Int32Array,
  freq: Int32Array,
  r: number,
  g: number,
  b: number,
): number {
  let bestd = 0x7fffffff;
  let bestbiasd = bestd;
  let bestpos = 0;
  let bestbiaspos = 0;

  for (let i = 0; i < NETSIZE; i++) {
    const i3 = i * 3;
    const dr = net[i3] - r;
    const dg = net[i3 + 1] - g;
    const db = net[i3 + 2] - b;
    let dist = dr < 0 ? -dr : dr;
    dist += dg < 0 ? -dg : dg;
    dist += db < 0 ? -db : db;

    if (dist < bestd) {
      bestd = dist;
      bestpos = i;
    }

    const biasdist = dist - (bias[i] >> (INTBIASSHIFT - NETBIASSHIFT));
    if (biasdist < bestbiasd) {
      bestbiasd = biasdist;
      bestbiaspos = i;
    }

    const betafreq = freq[i] >> BETASHIFT;
    freq[i] -= betafreq;
    bias[i] += betafreq << GAMMASHIFT;
  }

  freq[bestpos] += BETA;
  bias[bestpos] -= BETAGAMMA;
  return bestbiaspos;
}

// ── Neuron adjustment ────────────────────────────────────────────

function alterSingle(
  net: Int32Array,
  alpha: number,
  i: number,
  r: number,
  g: number,
  b: number,
): void {
  const i3 = i * 3;
  net[i3] -= ((alpha * (net[i3] - r)) / INITALPHA) | 0;
  net[i3 + 1] -= ((alpha * (net[i3 + 1] - g)) / INITALPHA) | 0;
  net[i3 + 2] -= ((alpha * (net[i3 + 2] - b)) / INITALPHA) | 0;
}

function alterNeighbours(
  net: Int32Array,
  rad: number,
  i: number,
  r: number,
  g: number,
  b: number,
  radpower: Int32Array,
): void {
  const lo = Math.max(0, i - rad);
  const hi = Math.min(MAXNETPOS, i + rad);

  let j = i + 1;
  let k = i - 1;
  let m = 1;

  while (j <= hi || k >= lo) {
    const a = radpower[m++];
    if (j <= hi) {
      const j3 = j * 3;
      net[j3] -= ((a * (net[j3] - r)) / ALPHARADBIAS) | 0;
      net[j3 + 1] -= ((a * (net[j3 + 1] - g)) / ALPHARADBIAS) | 0;
      net[j3 + 2] -= ((a * (net[j3 + 2] - b)) / ALPHARADBIAS) | 0;
      j++;
    }
    if (k >= lo) {
      const k3 = k * 3;
      net[k3] -= ((a * (net[k3] - r)) / ALPHARADBIAS) | 0;
      net[k3 + 1] -= ((a * (net[k3 + 1] - g)) / ALPHARADBIAS) | 0;
      net[k3 + 2] -= ((a * (net[k3 + 2] - b)) / ALPHARADBIAS) | 0;
      k--;
    }
  }
}
