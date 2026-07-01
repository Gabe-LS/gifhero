var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/quantizers/neuquant.ts
var NETSIZE = 256;
var MAXNETPOS = NETSIZE - 1;
var NCYCLES = 100;
var PRIME1 = 499;
var PRIME2 = 491;
var PRIME3 = 487;
var PRIME4 = 503;
var NETBIASSHIFT = 4;
var INTBIASSHIFT = 16;
var INTBIAS = 1 << INTBIASSHIFT;
var GAMMASHIFT = 10;
var BETASHIFT = 10;
var BETA = INTBIAS >> BETASHIFT;
var BETAGAMMA = INTBIAS << GAMMASHIFT - BETASHIFT;
var INITRAD = NETSIZE >> 3;
var RADIUSBIASSHIFT = 6;
var RADIUSBIAS = 1 << RADIUSBIASSHIFT;
var INITRADIUS = INITRAD * RADIUSBIAS;
var RADIUSDEC = 30;
var ALPHABIASSHIFT = 10;
var INITALPHA = 1 << ALPHABIASSHIFT;
var RADBIASSHIFT = 8;
var RADBIAS = 1 << RADBIASSHIFT;
var ALPHARADBSHIFT = ALPHABIASSHIFT + RADBIASSHIFT;
var ALPHARADBIAS = 1 << ALPHARADBSHIFT;
function neuquant(rgba, quality = 10) {
  const samplefac = Math.max(1, Math.min(30, quality));
  const pixelCount = rgba.length >> 2;
  const net = new Int32Array(NETSIZE * 3);
  const bias = new Int32Array(NETSIZE);
  const freq = new Int32Array(NETSIZE);
  for (let i = 0; i < NETSIZE; i++) {
    const v = (i << NETBIASSHIFT + 8) / NETSIZE | 0;
    const i3 = i * 3;
    net[i3] = v;
    net[i3 + 1] = v;
    net[i3 + 2] = v;
    freq[i] = INTBIAS / NETSIZE | 0;
  }
  learn(net, bias, freq, rgba, pixelCount, samplefac);
  const palette = new Uint8Array(NETSIZE * 3);
  for (let i = 0; i < NETSIZE; i++) {
    const i3 = i * 3;
    for (let c = 0; c < 3; c++) {
      let v = net[i3 + c] + (1 << NETBIASSHIFT - 1) >> NETBIASSHIFT;
      if (v < 0) v = 0;
      if (v > 255) v = 255;
      palette[i3 + c] = v;
    }
  }
  return palette;
}
function learn(net, bias, freq, rgba, pixelCount, samplefac) {
  const samplepixels = pixelCount / samplefac | 0;
  const alphadec = 30 + ((samplefac - 1) / 3 | 0);
  let alpha = INITALPHA;
  let radius = INITRADIUS;
  let rad = radius >> RADIUSBIASSHIFT;
  if (rad <= 1) rad = 0;
  const radpower = new Int32Array(INITRAD);
  for (let i = 0; i < rad; i++) {
    radpower[i] = alpha * ((rad * rad - i * i) * RADBIAS / (rad * rad)) | 0;
  }
  let step;
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
  const delta = Math.max(1, samplepixels / NCYCLES | 0);
  const byteLen = pixelCount << 2;
  let pos = 0;
  for (let i = 0; i < samplepixels; i++) {
    const r = (rgba[pos] & 255) << NETBIASSHIFT;
    const g = (rgba[pos + 1] & 255) << NETBIASSHIFT;
    const b = (rgba[pos + 2] & 255) << NETBIASSHIFT;
    const bestbiaspos = contest(net, bias, freq, r, g, b);
    alterSingle(net, alpha, bestbiaspos, r, g, b);
    if (rad > 0) {
      alterNeighbours(net, rad, bestbiaspos, r, g, b, radpower);
    }
    pos += step << 2;
    if (pos >= byteLen) pos -= byteLen;
    if ((i + 1) % delta === 0) {
      alpha -= alpha / alphadec | 0;
      if (alpha < 1) alpha = 1;
      radius -= radius / RADIUSDEC | 0;
      if (radius < 0) radius = 0;
      rad = radius >> RADIUSBIASSHIFT;
      if (rad <= 1) rad = 0;
      for (let j = 0; j < rad; j++) {
        radpower[j] = alpha * ((rad * rad - j * j) * RADBIAS / (rad * rad)) | 0;
      }
    }
  }
}
function contest(net, bias, freq, r, g, b) {
  let bestd = 2147483647;
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
    const biasdist = dist - (bias[i] >> INTBIASSHIFT - NETBIASSHIFT);
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
function alterSingle(net, alpha, i, r, g, b) {
  const i3 = i * 3;
  net[i3] -= alpha * (net[i3] - r) / INITALPHA | 0;
  net[i3 + 1] -= alpha * (net[i3 + 1] - g) / INITALPHA | 0;
  net[i3 + 2] -= alpha * (net[i3 + 2] - b) / INITALPHA | 0;
}
function alterNeighbours(net, rad, i, r, g, b, radpower) {
  const lo = Math.max(0, i - rad);
  const hi = Math.min(MAXNETPOS, i + rad);
  let j = i + 1;
  let k = i - 1;
  let m = 1;
  while (j <= hi || k >= lo) {
    const a = radpower[m++];
    if (j <= hi) {
      const j3 = j * 3;
      net[j3] -= a * (net[j3] - r) / ALPHARADBIAS | 0;
      net[j3 + 1] -= a * (net[j3 + 1] - g) / ALPHARADBIAS | 0;
      net[j3 + 2] -= a * (net[j3 + 2] - b) / ALPHARADBIAS | 0;
      j++;
    }
    if (k >= lo) {
      const k3 = k * 3;
      net[k3] -= a * (net[k3] - r) / ALPHARADBIAS | 0;
      net[k3 + 1] -= a * (net[k3 + 1] - g) / ALPHARADBIAS | 0;
      net[k3 + 2] -= a * (net[k3 + 2] - b) / ALPHARADBIAS | 0;
      k--;
    }
  }
}

// src/dither/floyd-steinberg.ts
function floydSteinberg(rgba, width, height, palette, serpentine = true) {
  const numColors = palette.length / 3 | 0;
  const indexed = new Uint8Array(width * height);
  const cache = buildColorCache(palette, numColors);
  const stride = (width + 4) * 3;
  const PAD = 2 * 3;
  let errCurr = new Float32Array(stride);
  let errNext = new Float32Array(stride);
  for (let y = 0; y < height; y++) {
    errNext.fill(0);
    const forward = !serpentine || (y & 1) === 0;
    const x0 = forward ? 0 : width - 1;
    const x1 = forward ? width : -1;
    const dx = forward ? 1 : -1;
    for (let x = x0; x !== x1; x += dx) {
      const pi = y * width + x << 2;
      const ei = PAD + x * 3;
      const ar = rgba[pi] + errCurr[ei];
      const ag = rgba[pi + 1] + errCurr[ei + 1];
      const ab = rgba[pi + 2] + errCurr[ei + 2];
      const cr = ar < 0 ? 0 : ar > 255 ? 255 : ar + 0.5 | 0;
      const cg = ag < 0 ? 0 : ag > 255 ? 255 : ag + 0.5 | 0;
      const cb = ab < 0 ? 0 : ab > 255 ? 255 : ab + 0.5 | 0;
      const best = cache[cr >> 3 << 10 | cg >> 3 << 5 | cb >> 3];
      indexed[y * width + x] = best;
      const b3 = best * 3;
      const er = ar - palette[b3];
      const eg = ag - palette[b3 + 1];
      const eb = ab - palette[b3 + 2];
      const fwd = ei + dx * 3;
      const bwd = ei - dx * 3;
      errCurr[fwd] += er * 0.4375;
      errCurr[fwd + 1] += eg * 0.4375;
      errCurr[fwd + 2] += eb * 0.4375;
      errNext[bwd] += er * 0.1875;
      errNext[bwd + 1] += eg * 0.1875;
      errNext[bwd + 2] += eb * 0.1875;
      errNext[ei] += er * 0.3125;
      errNext[ei + 1] += eg * 0.3125;
      errNext[ei + 2] += eb * 0.3125;
      errNext[fwd] += er * 0.0625;
      errNext[fwd + 1] += eg * 0.0625;
      errNext[fwd + 2] += eb * 0.0625;
    }
    const tmp = errCurr;
    errCurr = errNext;
    errNext = tmp;
  }
  return indexed;
}
function mapNearest(rgba, palette) {
  const numColors = palette.length / 3 | 0;
  const pixelCount = rgba.length >> 2;
  const cache = buildColorCache(palette, numColors);
  const indexed = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const p = i << 2;
    indexed[i] = cache[rgba[p] >> 3 << 10 | rgba[p + 1] >> 3 << 5 | rgba[p + 2] >> 3];
  }
  return indexed;
}
function buildColorCache(palette, numColors) {
  const cache = new Uint8Array(32768);
  for (let ri = 0; ri < 32; ri++) {
    const r = ri << 3 | ri >> 2;
    for (let gi = 0; gi < 32; gi++) {
      const g = gi << 3 | gi >> 2;
      for (let bi = 0; bi < 32; bi++) {
        const b = bi << 3 | bi >> 2;
        let bestDist = 2147483647;
        let bestIdx = 0;
        for (let j = 0; j < numColors; j++) {
          const j3 = j * 3;
          const dr = r - palette[j3];
          const dg = g - palette[j3 + 1];
          const db = b - palette[j3 + 2];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = j;
          }
        }
        cache[ri << 10 | gi << 5 | bi] = bestIdx;
      }
    }
  }
  return cache;
}

// src/dither/temporal.ts
function ditherFrameTemporal(rgba, width, height, palette, prevState, prevRgba, options) {
  const { serpentine, temporalWeight } = options;
  const numPixels = width * height;
  const numColors = palette.length / 3 | 0;
  const cache = buildColorCache(palette, numColors);
  const indexed = new Uint8Array(numPixels);
  const canLock = prevState !== null && prevRgba !== null && temporalWeight > 0;
  const prevIndexed = prevState?.prevIndexed ?? null;
  const prevPalette = prevState?.prevPalette ?? null;
  const lockThreshold = 5;
  const stride = (width + 4) * 3;
  const PAD = 2 * 3;
  let errCurr = new Float32Array(stride);
  let errNext = new Float32Array(stride);
  for (let y = 0; y < height; y++) {
    errNext.fill(0);
    const forward = !serpentine || (y & 1) === 0;
    const x0 = forward ? 0 : width - 1;
    const x1 = forward ? width : -1;
    const dx = forward ? 1 : -1;
    for (let x = x0; x !== x1; x += dx) {
      const pixelIdx = y * width + x;
      const pi = pixelIdx << 2;
      const ei = PAD + x * 3;
      const sr = rgba[pi];
      const sg = rgba[pi + 1];
      const sb = rgba[pi + 2];
      const ar = sr + errCurr[ei];
      const ag = sg + errCurr[ei + 1];
      const ab = sb + errCurr[ei + 2];
      const cr = ar < 0 ? 0 : ar > 255 ? 255 : ar + 0.5 | 0;
      const cg = ag < 0 ? 0 : ag > 255 ? 255 : ag + 0.5 | 0;
      const cb = ab < 0 ? 0 : ab > 255 ? 255 : ab + 0.5 | 0;
      let best = cache[cr >> 3 << 10 | cg >> 3 << 5 | cb >> 3];
      if (canLock) {
        const dr = sr - prevRgba[pi];
        const dg = sg - prevRgba[pi + 1];
        const db = sb - prevRgba[pi + 2];
        const l1 = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
        if (l1 <= lockThreshold) {
          const pIdx = prevIndexed[pixelIdx];
          const p3 = pIdx * 3;
          const lockedBest = cache[prevPalette[p3] >> 3 << 10 | prevPalette[p3 + 1] >> 3 << 5 | prevPalette[p3 + 2] >> 3];
          const lb = lockedBest * 3;
          const nb = best * 3;
          const cd = Math.abs(palette[lb] - palette[nb]) + Math.abs(palette[lb + 1] - palette[nb + 1]) + Math.abs(palette[lb + 2] - palette[nb + 2]);
          if (cd <= 30) best = lockedBest;
        }
      }
      indexed[pixelIdx] = best;
      const b3 = best * 3;
      const er = sr + errCurr[ei] - palette[b3];
      const eg = sg + errCurr[ei + 1] - palette[b3 + 1];
      const eb = sb + errCurr[ei + 2] - palette[b3 + 2];
      const fwd = ei + dx * 3;
      const bwd = ei - dx * 3;
      errCurr[fwd] += er * 0.4375;
      errCurr[fwd + 1] += eg * 0.4375;
      errCurr[fwd + 2] += eb * 0.4375;
      errNext[bwd] += er * 0.1875;
      errNext[bwd + 1] += eg * 0.1875;
      errNext[bwd + 2] += eb * 0.1875;
      errNext[ei] += er * 0.3125;
      errNext[ei + 1] += eg * 0.3125;
      errNext[ei + 2] += eb * 0.3125;
      errNext[fwd] += er * 0.0625;
      errNext[fwd + 1] += eg * 0.0625;
      errNext[fwd + 2] += eb * 0.0625;
    }
    const tmp = errCurr;
    errCurr = errNext;
    errNext = tmp;
  }
  return {
    indexed,
    nextState: {
      prevIndexed: indexed,
      prevPalette: new Uint8Array(palette)
    }
  };
}

// src/encoder/lzw.ts
var MAX_CODE = 4095;
function lzwEncode(pixels, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const output = [];
  let curByte = 0;
  let curBits = 0;
  function emit(code, size) {
    curByte |= code << curBits;
    curBits += size;
    while (curBits >= 8) {
      output.push(curByte & 255);
      curByte >>>= 8;
      curBits -= 8;
    }
  }
  let dict = /* @__PURE__ */ new Map();
  let nextCode = 0;
  let codeSize = 0;
  function reset() {
    dict.clear();
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  }
  reset();
  emit(clearCode, codeSize);
  if (pixels.length === 0) {
    emit(eoiCode, codeSize);
    if (curBits > 0) output.push(curByte & 255);
    return new Uint8Array(output);
  }
  let prefix = pixels[0];
  let deferring = false;
  let deferStart = 0;
  let deferPixels = 0;
  const DEFER_WINDOW = 256;
  for (let i = 1; i < pixels.length; i++) {
    const suffix = pixels[i];
    const key = prefix << 8 | suffix;
    if (dict.has(key)) {
      prefix = dict.get(key);
    } else {
      emit(prefix, codeSize);
      if (nextCode <= MAX_CODE) {
        if (nextCode >= 1 << codeSize && codeSize < 12) {
          codeSize++;
        }
        dict.set(key, nextCode);
        nextCode++;
      } else if (!deferring) {
        deferring = true;
        deferStart = output.length;
        deferPixels = 0;
      }
      if (deferring) {
        deferPixels++;
        if (deferPixels >= DEFER_WINDOW) {
          const bytesEmitted = output.length - deferStart;
          const bitsPerPixel = bytesEmitted * 8 / deferPixels;
          if (bitsPerPixel > 11) {
            emit(clearCode, codeSize);
            reset();
            deferring = false;
          } else {
            deferStart = output.length;
            deferPixels = 0;
          }
        }
      }
      prefix = suffix;
    }
  }
  emit(prefix, codeSize);
  emit(eoiCode, codeSize);
  if (curBits > 0) output.push(curByte & 255);
  return new Uint8Array(output);
}

// src/encoder/lossy-lzw.ts
var MAX_CODE2 = 4095;
function buildDistTable(palette) {
  const n = palette.length / 3 | 0;
  const dist = new Uint8Array(256 * 256);
  for (let i = 0; i < n; i++) {
    const ri = palette[i * 3];
    const gi = palette[i * 3 + 1];
    const bi = palette[i * 3 + 2];
    for (let j = i + 1; j < n; j++) {
      const d = Math.max(
        Math.abs(ri - palette[j * 3]),
        Math.abs(gi - palette[j * 3 + 1]),
        Math.abs(bi - palette[j * 3 + 2])
      );
      dist[i * 256 + j] = d;
      dist[j * 256 + i] = d;
    }
  }
  return dist;
}
function lzwEncodeLossy(pixels, palette, minCodeSize, lossiness, transparentIndex = -1) {
  const isLossy = lossiness > 0;
  const numColors = palette.length / 3 | 0;
  const distTable = isLossy ? buildDistTable(palette) : null;
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const output = [];
  let curByte = 0;
  let curBits = 0;
  function emit(code, size) {
    curByte |= code << curBits;
    curBits += size;
    while (curBits >= 8) {
      output.push(curByte & 255);
      curByte >>>= 8;
      curBits -= 8;
    }
  }
  let dict = /* @__PURE__ */ new Map();
  let nextCode = 0;
  let codeSize = 0;
  function reset() {
    dict.clear();
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  }
  reset();
  emit(clearCode, codeSize);
  if (pixels.length === 0) {
    emit(eoiCode, codeSize);
    if (curBits > 0) output.push(curByte & 255);
    return new Uint8Array(output);
  }
  let prefix = pixels[0];
  let deferring = false;
  let deferStart = 0;
  let deferPixels = 0;
  const DEFER_WINDOW = 256;
  function checkDefer() {
    if (!deferring) return;
    deferPixels++;
    if (deferPixels >= DEFER_WINDOW) {
      const bytesEmitted = output.length - deferStart;
      const bitsPerPixel = bytesEmitted * 8 / deferPixels;
      if (bitsPerPixel > 11) {
        emit(clearCode, codeSize);
        reset();
        deferring = false;
      } else {
        deferStart = output.length;
        deferPixels = 0;
      }
    }
  }
  for (let i = 1; i < pixels.length; i++) {
    const suffix = pixels[i];
    const exactKey = prefix << 8 | suffix;
    if (dict.has(exactKey)) {
      prefix = dict.get(exactKey);
    } else if (isLossy && suffix !== transparentIndex) {
      let bestKey = -1;
      let bestDist = lossiness + 1;
      const base = suffix * 256;
      for (let alt = 0; alt < numColors; alt++) {
        if (alt === suffix || alt === transparentIndex) continue;
        const d = distTable[base + alt];
        if (d <= lossiness && d < bestDist) {
          const altKey = prefix << 8 | alt;
          if (dict.has(altKey)) {
            bestKey = altKey;
            bestDist = d;
          }
        }
      }
      if (bestKey >= 0) {
        prefix = dict.get(bestKey);
      } else {
        emit(prefix, codeSize);
        if (nextCode <= MAX_CODE2) {
          if (nextCode >= 1 << codeSize && codeSize < 12) {
            codeSize++;
          }
          dict.set(exactKey, nextCode);
          nextCode++;
        } else if (!deferring) {
          deferring = true;
          deferStart = output.length;
          deferPixels = 0;
        }
        checkDefer();
        prefix = suffix;
      }
    } else {
      emit(prefix, codeSize);
      if (nextCode <= MAX_CODE2) {
        if (nextCode >= 1 << codeSize && codeSize < 12) {
          codeSize++;
        }
        dict.set(exactKey, nextCode);
        nextCode++;
      } else if (!deferring) {
        deferring = true;
        deferStart = output.length;
        deferPixels = 0;
      }
      checkDefer();
      prefix = suffix;
    }
  }
  emit(prefix, codeSize);
  emit(eoiCode, codeSize);
  if (curBits > 0) output.push(curByte & 255);
  return new Uint8Array(output);
}

// src/encoder/gif-writer.ts
function writeGif(frames, options) {
  const buf = new GifBuffer();
  writeHeader(buf);
  writeLogicalScreenDescriptor(buf, options);
  if (options.globalPalette) {
    const { padded } = padPalette(options.globalPalette);
    buf.writeBytes(padded);
  }
  const loop = options.loop ?? 0;
  if (loop >= 0) {
    writeNetscapeExtension(buf, loop);
  }
  for (const frame of frames) {
    writeGraphicControlExtension(buf, frame);
    writeImageBlock(buf, frame, options);
  }
  buf.writeByte(59);
  return buf.toUint8Array();
}
function writeHeader(buf) {
  buf.writeString("GIF89a");
}
function writeLogicalScreenDescriptor(buf, opts) {
  buf.writeUint16LE(opts.width);
  buf.writeUint16LE(opts.height);
  const hasGCT = opts.globalPalette != null;
  const { sizeField } = hasGCT ? padPalette(opts.globalPalette) : { sizeField: 0 };
  const colorResolution = hasGCT ? sizeField : 7;
  const packed = (hasGCT ? 1 : 0) << 7 | colorResolution << 4 | 0 << 3 | // sort flag
  (hasGCT ? sizeField : 0);
  buf.writeByte(packed);
  buf.writeByte(opts.backgroundIndex ?? 0);
  buf.writeByte(0);
}
function writeNetscapeExtension(buf, loopCount) {
  buf.writeByte(33);
  buf.writeByte(255);
  buf.writeByte(11);
  buf.writeString("NETSCAPE2.0");
  buf.writeByte(3);
  buf.writeByte(1);
  buf.writeUint16LE(loopCount);
  buf.writeByte(0);
}
function writeGraphicControlExtension(buf, frame) {
  const disposal = frame.disposal ?? 0;
  const delay = frame.delay ?? 0;
  const hasTransparency = frame.transparentIndex != null && frame.transparentIndex >= 0;
  buf.writeByte(33);
  buf.writeByte(249);
  buf.writeByte(4);
  buf.writeByte((disposal & 7) << 2 | (hasTransparency ? 1 : 0));
  buf.writeUint16LE(delay);
  buf.writeByte(hasTransparency ? frame.transparentIndex : 0);
  buf.writeByte(0);
}
function writeImageBlock(buf, frame, opts) {
  const usesLocalPalette = frame.palette != null;
  const palette = usesLocalPalette ? frame.palette : opts.globalPalette;
  if (!palette) {
    throw new Error(
      "Frame has no palette and no global palette was provided \u2014 every frame needs a color table"
    );
  }
  const minEntries = frame.transparentIndex != null && frame.transparentIndex >= 0 ? frame.transparentIndex + 1 : 0;
  const { padded, sizeField, minCodeSize } = padPalette(palette, minEntries);
  buf.writeByte(44);
  buf.writeUint16LE(frame.left ?? 0);
  buf.writeUint16LE(frame.top ?? 0);
  buf.writeUint16LE(frame.width);
  buf.writeUint16LE(frame.height);
  const packed = (usesLocalPalette ? 1 : 0) << 7 | 0 << 6 | // interlace
  0 << 5 | // sort
  (usesLocalPalette ? sizeField : 0);
  buf.writeByte(packed);
  if (usesLocalPalette) {
    buf.writeBytes(padded);
  }
  const encoder = opts.lzwEncoder ?? lzwEncode;
  const compressed = encoder(frame.indexedPixels, minCodeSize);
  buf.writeByte(minCodeSize);
  writeSubBlocks(buf, compressed);
  buf.writeByte(0);
}
function writeSubBlocks(buf, data) {
  let offset = 0;
  while (offset < data.length) {
    const blockSize = Math.min(255, data.length - offset);
    buf.writeByte(blockSize);
    for (let i = 0; i < blockSize; i++) {
      buf.writeByte(data[offset + i]);
    }
    offset += blockSize;
  }
}
function padPalette(palette, minEntries = 0) {
  const numColors = Math.max(palette.length / 3, minEntries);
  let bits = 1;
  while (1 << bits < numColors) bits++;
  const paddedCount = 1 << bits;
  const paddedSize = paddedCount * 3;
  let padded;
  if (palette.length === paddedSize) {
    padded = palette;
  } else {
    padded = new Uint8Array(paddedSize);
    padded.set(palette);
  }
  return {
    padded,
    bits,
    sizeField: bits - 1,
    minCodeSize: Math.max(2, bits)
  };
}
var GifBuffer = class {
  constructor() {
    this.chunks = [];
  }
  writeByte(b) {
    this.chunks.push(b & 255);
  }
  writeBytes(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      this.chunks.push(bytes[i]);
    }
  }
  writeUint16LE(n) {
    this.chunks.push(n & 255);
    this.chunks.push(n >> 8 & 255);
  }
  writeString(s) {
    for (let i = 0; i < s.length; i++) {
      this.chunks.push(s.charCodeAt(i));
    }
  }
  toUint8Array() {
    return new Uint8Array(this.chunks);
  }
};

// src/optimize/frame-diff.ts
function computeFrameDiff(currentIndexed, currentRgba, prevRgba, canvasWidth, canvasHeight, tolerance) {
  const pixelCount = canvasWidth * canvasHeight;
  let minX = canvasWidth;
  let maxX = -1;
  let minY = canvasHeight;
  let maxY = -1;
  const changed = new Uint8Array(pixelCount);
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = y * canvasWidth + x;
      const ri = i << 2;
      const dist = Math.abs(currentRgba[ri] - prevRgba[ri]) + Math.abs(currentRgba[ri + 1] - prevRgba[ri + 1]) + Math.abs(currentRgba[ri + 2] - prevRgba[ri + 2]);
      if (dist > tolerance) {
        changed[i] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const DILATE = 2;
  const dilated = new Uint8Array(pixelCount);
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      if (changed[y * canvasWidth + x]) {
        const y0 = Math.max(0, y - DILATE);
        const y1 = Math.min(canvasHeight - 1, y + DILATE);
        const x0 = Math.max(0, x - DILATE);
        const x1 = Math.min(canvasWidth - 1, x + DILATE);
        for (let dy = y0; dy <= y1; dy++) {
          for (let dx = x0; dx <= x1; dx++) {
            dilated[dy * canvasWidth + dx] = 1;
          }
        }
      }
    }
  }
  minX = canvasWidth;
  maxX = -1;
  minY = canvasHeight;
  maxY = -1;
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = y * canvasWidth + x;
      if (dilated[i]) {
        changed[i] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return {
      indexedPixels: new Uint8Array([0]),
      transparentIndex: 0,
      left: 0,
      top: 0,
      width: 1,
      height: 1
    };
  }
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const usedByChanged = new Uint8Array(256);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * canvasWidth + x;
      if (changed[i]) {
        usedByChanged[currentIndexed[i]] = 1;
      }
    }
  }
  let transparentIndex = -1;
  for (let i = 255; i >= 0; i--) {
    if (!usedByChanged[i]) {
      transparentIndex = i;
      break;
    }
  }
  if (transparentIndex < 0) {
    return {
      indexedPixels: currentIndexed.slice(),
      transparentIndex: -1,
      left: 0,
      top: 0,
      width: canvasWidth,
      height: canvasHeight
    };
  }
  const cropped = new Uint8Array(cropW * cropH);
  for (let cy = 0; cy < cropH; cy++) {
    for (let cx = 0; cx < cropW; cx++) {
      const srcI = (minY + cy) * canvasWidth + (minX + cx);
      cropped[cy * cropW + cx] = changed[srcI] ? currentIndexed[srcI] : transparentIndex;
    }
  }
  return {
    indexedPixels: cropped,
    transparentIndex,
    left: minX,
    top: minY,
    width: cropW,
    height: cropH
  };
}
function countChangedPixelsRgba(aRgba, bRgba, pixelCount, tolerance) {
  let count = 0;
  for (let i = 0; i < pixelCount; i++) {
    const ri = i << 2;
    const dist = Math.abs(aRgba[ri] - bRgba[ri]) + Math.abs(aRgba[ri + 1] - bRgba[ri + 1]) + Math.abs(aRgba[ri + 2] - bRgba[ri + 2]);
    if (dist > tolerance) count++;
  }
  return count;
}

// src/optimize/disposal.ts
function optimizeDisposals(frames, canvasWidth, canvasHeight, tolerance) {
  const len = frames.length;
  const disposals = new Array(len).fill(0);
  if (len < 2) return disposals;
  const pixelCount = canvasWidth * canvasHeight;
  const bgRgba = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < len - 1; i++) {
    const noneChanged = countChangedPixelsRgba(
      frames[i].data,
      frames[i + 1].data,
      pixelCount,
      tolerance
    );
    const bgChanged = countChangedPixelsRgba(
      bgRgba,
      frames[i + 1].data,
      pixelCount,
      tolerance
    );
    disposals[i] = noneChanged <= bgChanged ? 0 : 2;
  }
  return disposals;
}

// src/optimize/palette-strategy.ts
function generatePalettes(frames, strategy, quality) {
  if (frames.length === 0) return [];
  switch (strategy) {
    case "local":
      return localStrategy(frames, quality);
    case "global":
      return globalStrategy(frames, quality);
    case "crossframe":
      return crossframeStrategy(frames, quality);
    case "adaptive":
      return adaptiveStrategy(frames, quality);
  }
}
function localStrategy(frames, quality) {
  const palettes = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    palettes[i] = neuquant(frames[i].data, quality);
  }
  return palettes;
}
function globalStrategy(frames, quality) {
  const step = frames.length < 10 ? 1 : 5;
  let totalBytes = 0;
  for (let i = 0; i < frames.length; i += step) {
    totalBytes += frames[i].data.length;
  }
  const pooled = new Uint8ClampedArray(totalBytes);
  let offset = 0;
  for (let i = 0; i < frames.length; i += step) {
    pooled.set(frames[i].data, offset);
    offset += frames[i].data.length;
  }
  const palette = neuquant(pooled, quality);
  const palettes = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    palettes[i] = palette;
  }
  return palettes;
}
function crossframeStrategy(frames, quality) {
  const palettes = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    palettes[i] = crossframeQuantize(frames, i, quality);
  }
  return palettes;
}
function crossframeQuantize(frames, index, quality) {
  const current = frames[index].data;
  const prev = index > 0 ? frames[index - 1].data : null;
  const next = index < frames.length - 1 ? frames[index + 1].data : null;
  const prevSampled = prev ? subsampleEveryNth(prev, 3) : null;
  const nextSampled = next ? subsampleEveryNth(next, 3) : null;
  const totalBytes = current.length + (prevSampled ? prevSampled.length : 0) + (nextSampled ? nextSampled.length : 0);
  const combined = new Uint8ClampedArray(totalBytes);
  let offset = 0;
  combined.set(current, offset);
  offset += current.length;
  if (prevSampled) {
    combined.set(prevSampled, offset);
    offset += prevSampled.length;
  }
  if (nextSampled) {
    combined.set(nextSampled, offset);
  }
  return neuquant(combined, quality);
}
function subsampleEveryNth(rgba, n) {
  const pixelCount = rgba.length >> 2;
  const sampledCount = Math.ceil(pixelCount / n);
  const result = new Uint8ClampedArray(sampledCount * 4);
  let writeIdx = 0;
  for (let i = 0; i < pixelCount; i += n) {
    const srcOff = i << 2;
    result[writeIdx] = rgba[srcOff];
    result[writeIdx + 1] = rgba[srcOff + 1];
    result[writeIdx + 2] = rgba[srcOff + 2];
    result[writeIdx + 3] = rgba[srcOff + 3];
    writeIdx += 4;
  }
  return result;
}
function adaptiveStrategy(frames, quality) {
  const palettes = new Array(frames.length);
  palettes[0] = neuquant(frames[0].data, quality);
  for (let i = 1; i < frames.length; i++) {
    const changedFraction = estimateChangedFraction(
      frames[i - 1].data,
      frames[i].data
    );
    if (changedFraction < 0.05) {
      palettes[i] = palettes[i - 1];
    } else if (changedFraction <= 0.3) {
      palettes[i] = crossframeQuantize(frames, i, quality);
    } else {
      palettes[i] = neuquant(frames[i].data, quality);
    }
  }
  return palettes;
}
function estimateChangedFraction(prev, curr) {
  const pixelCount = Math.min(prev.length, curr.length) >> 2;
  if (pixelCount === 0) return 1;
  let sampled = 0;
  let changed = 0;
  for (let i = 0; i < pixelCount; i += 10) {
    const off = i << 2;
    const dr = prev[off] - curr[off];
    const dg = prev[off + 1] - curr[off + 1];
    const db = prev[off + 2] - curr[off + 2];
    const l1 = (dr < 0 ? -dr : dr) + (dg < 0 ? -dg : dg) + (db < 0 ? -db : db);
    sampled++;
    if (l1 > 15) changed++;
  }
  return changed / sampled;
}

// src/optimize/subframe.ts
function cropRgba(src, srcW, left, top, cw, ch) {
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcOff = ((top + y) * srcW + left) * 4;
    out.set(src.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return out;
}
function findChangedBbox(curr, prev, canvas, staticMask, w, h, staleThreshold) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pi = y * w + x;
      if (staticMask[pi]) continue;
      const si = pi * 4;
      const canvasDiff = Math.max(
        Math.abs(curr[si] - canvas[si]),
        Math.abs(curr[si + 1] - canvas[si + 1]),
        Math.abs(curr[si + 2] - canvas[si + 2])
      );
      if (canvasDiff > staleThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, maxX, minY, maxY };
}
function buildSubframe(indexedPixels, palette, currRgba, canvasRgba, staticMask, cropLeft, cropTop, cw, ch, fullW, staleThreshold) {
  const pixelCount = cw * ch;
  const numColors = palette.length / 3 | 0;
  const changed = new Uint8Array(pixelCount);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const pi = y * cw + x;
      const fi = (cropTop + y) * fullW + (cropLeft + x);
      if (staticMask[fi]) continue;
      const si = fi * 4;
      const canvasDiff = Math.max(
        Math.abs(currRgba[si] - canvasRgba[si]),
        Math.abs(currRgba[si + 1] - canvasRgba[si + 1]),
        Math.abs(currRgba[si + 2] - canvasRgba[si + 2])
      );
      if (canvasDiff > staleThreshold) {
        changed[pi] = 1;
      }
    }
  }
  const usedByChanged = new Uint8Array(256);
  for (let i = 0; i < pixelCount; i++) {
    if (changed[i]) usedByChanged[indexedPixels[i]] = 1;
  }
  let palBits = 1;
  while (1 << palBits < numColors) palBits++;
  const maxIdx = (1 << palBits) - 1;
  let tIdx = -1;
  for (let i = maxIdx; i >= 0; i--) {
    if (!usedByChanged[i]) {
      tIdx = i;
      break;
    }
  }
  let pixels = indexedPixels;
  if (tIdx < 0) {
    const changedCount = new Uint32Array(256);
    for (let i = 0; i < pixelCount; i++) {
      if (changed[i]) changedCount[indexedPixels[i]]++;
    }
    let minCount = 2147483647;
    let evictIdx = 0;
    for (let i = 0; i < numColors; i++) {
      if (changedCount[i] > 0 && changedCount[i] < minCount) {
        minCount = changedCount[i];
        evictIdx = i;
      }
    }
    tIdx = evictIdx;
    usedByChanged[evictIdx] = 0;
    pixels = indexedPixels.slice();
    const evR = palette[evictIdx * 3], evG = palette[evictIdx * 3 + 1], evB = palette[evictIdx * 3 + 2];
    let bestAlt = 0, bestDist = 2147483647;
    for (let p = 0; p < numColors; p++) {
      if (p === evictIdx) continue;
      const po = p * 3;
      const d = Math.abs(evR - palette[po]) + Math.abs(evG - palette[po + 1]) + Math.abs(evB - palette[po + 2]);
      if (d < bestDist) {
        bestDist = d;
        bestAlt = p;
      }
    }
    for (let i = 0; i < pixelCount; i++) {
      if (changed[i] && pixels[i] === evictIdx) {
        pixels[i] = bestAlt;
      }
    }
    usedByChanged[bestAlt] = 1;
  }
  if (tIdx < 0) {
    return {
      indexedPixels: indexedPixels.slice(),
      transparentIndex: -1,
      left: cropLeft,
      top: cropTop,
      width: cw,
      height: ch
    };
  }
  const punched = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    punched[i] = changed[i] ? pixels[i] : tIdx;
  }
  let minX = cw, maxX = -1, minY = ch, maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (punched[y * cw + x] !== tIdx) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return {
      indexedPixels: new Uint8Array([0]),
      transparentIndex: 0,
      left: 0,
      top: 0,
      width: 1,
      height: 1
    };
  }
  const outW = maxX - minX + 1;
  const outH = maxY - minY + 1;
  const out = new Uint8Array(outW * outH);
  for (let cy = 0; cy < outH; cy++) {
    for (let cx = 0; cx < outW; cx++) {
      out[cy * outW + cx] = punched[(minY + cy) * cw + (minX + cx)];
    }
  }
  return {
    indexedPixels: out,
    transparentIndex: tIdx,
    left: cropLeft + minX,
    top: cropTop + minY,
    width: outW,
    height: outH
  };
}
function compositeOntoCanvas(canvas, sub, palette, fullW) {
  const { indexedPixels, transparentIndex, left, top, width, height } = sub;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = indexedPixels[y * width + x];
      if (idx === transparentIndex) continue;
      const ci = ((top + y) * fullW + (left + x)) * 4;
      const pi = idx * 3;
      canvas[ci] = palette[pi];
      canvas[ci + 1] = palette[pi + 1];
      canvas[ci + 2] = palette[pi + 2];
      canvas[ci + 3] = 255;
    }
  }
}
function decodeFrameToCanvas(canvas, indexed, palette, w, h) {
  for (let i = 0; i < w * h; i++) {
    const pi = indexed[i] * 3;
    const ci = i * 4;
    canvas[ci] = palette[pi];
    canvas[ci + 1] = palette[pi + 1];
    canvas[ci + 2] = palette[pi + 2];
    canvas[ci + 3] = 255;
  }
}
function trimPalette(palette, indexed, transparentIndex) {
  const used = new Uint8Array(256);
  for (let i = 0; i < indexed.length; i++) used[indexed[i]] = 1;
  if (transparentIndex != null && transparentIndex >= 0) used[transparentIndex] = 1;
  let count = 0;
  for (let i = 0; i < 256; i++) if (used[i]) count++;
  const origColors = palette.length / 3 | 0;
  if (count >= origColors) return { palette, indexed, transparentIndex };
  let po2 = 2;
  while (po2 < count) po2 <<= 1;
  const prevPo2 = po2 >> 1;
  const overshoot = count - prevPo2;
  if (overshoot > 0 && overshoot <= Math.max(1, count >> 4) && prevPo2 >= 4) {
    const freq = new Uint32Array(256);
    for (let i = 0; i < indexed.length; i++) freq[indexed[i]]++;
    if (transparentIndex != null && transparentIndex >= 0) freq[transparentIndex] = 4294967295;
    const usedIndices = [];
    for (let i = 0; i < 256; i++) if (used[i]) usedIndices.push(i);
    usedIndices.sort((a, b) => freq[a] - freq[b]);
    for (let e = 0; e < overshoot; e++) {
      const victim = usedIndices[e];
      if (transparentIndex != null && victim === transparentIndex) continue;
      let bestDist = Infinity, bestIdx = -1;
      const vr = palette[victim * 3], vg = palette[victim * 3 + 1], vb = palette[victim * 3 + 2];
      for (const j of usedIndices) {
        if (j === victim || !used[j]) continue;
        if (transparentIndex != null && j === transparentIndex) continue;
        const d = Math.abs(palette[j * 3] - vr) + Math.abs(palette[j * 3 + 1] - vg) + Math.abs(palette[j * 3 + 2] - vb);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        for (let i = 0; i < indexed.length; i++) {
          if (indexed[i] === victim) indexed[i] = bestIdx;
        }
        used[victim] = 0;
        count--;
      }
    }
  }
  const oldToNew = new Uint8Array(256);
  const newPal = new Uint8Array(count * 3);
  let slot = 0;
  for (let i = 0; i < 256; i++) {
    if (!used[i]) continue;
    oldToNew[i] = slot;
    const oi = i * 3;
    if (oi + 2 < palette.length) {
      newPal[slot * 3] = palette[oi];
      newPal[slot * 3 + 1] = palette[oi + 1];
      newPal[slot * 3 + 2] = palette[oi + 2];
    }
    slot++;
  }
  const remapped = new Uint8Array(indexed.length);
  for (let i = 0; i < indexed.length; i++) remapped[i] = oldToNew[indexed[i]];
  return {
    palette: newPal,
    indexed: remapped,
    transparentIndex: transparentIndex != null && transparentIndex >= 0 ? oldToNew[transparentIndex] : transparentIndex
  };
}
function countUsedColors(indexed) {
  const used = new Uint8Array(256);
  for (let i = 0; i < indexed.length; i++) used[indexed[i]] = 1;
  let count = 0;
  for (let i = 0; i < 256; i++) if (used[i]) count++;
  return count;
}

// src/probe.ts
function probeFrames(frames, width, height, tolerance = 3) {
  const numPixels = width * height;
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
    if (maxR[i] - minR[i] <= tolerance && maxG[i] - minG[i] <= tolerance && maxB[i] - minB[i] <= tolerance) {
      staticMask[i] = 1;
      staticCount++;
    }
  }
  const staticFraction = staticCount / numPixels;
  const perFrameMotion = [0];
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
        Math.abs(curr[idx + 2] - prev[idx + 2])
      );
      if (d > 5) changed++;
    }
    const fraction = changed / numPixels;
    perFrameMotion.push(fraction);
    totalMotion += fraction;
  }
  const motionLevel = frames.length > 1 ? totalMotion / (frames.length - 1) : 0;
  const colorSet = /* @__PURE__ */ new Set();
  let gradientPixels = 0, gradientSamples = 0;
  for (let f = 0; f < frames.length; f += 5) {
    const frame = frames[f];
    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      const r6 = frame[idx] >> 2;
      const g6 = frame[idx + 1] >> 2;
      const b6 = frame[idx + 2] >> 2;
      colorSet.add(r6 << 12 | g6 << 6 | b6);
    }
    const gradThresh = 3;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const ci = (y * width + x) * 4;
        const cr = frame[ci], cg = frame[ci + 1], cb = frame[ci + 2];
        let smooth = true;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          if (Math.abs(cr - frame[ni]) > gradThresh || Math.abs(cg - frame[ni + 1]) > gradThresh || Math.abs(cb - frame[ni + 2]) > gradThresh) {
            smooth = false;
            break;
          }
        }
        if (smooth) gradientPixels++;
        gradientSamples++;
      }
    }
  }
  const gradientDensity = gradientSamples > 0 ? gradientPixels / gradientSamples : 0;
  const sceneThreshold = 0.6;
  const sceneChanges = [];
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
    gradientDensity,
    sceneChanges,
    perFrameMotion
  };
}
var IncrementalProbe = class {
  constructor(width, height, tolerance = 3) {
    this.width = width;
    this.height = height;
    this.prevFrame = null;
    this.perFrameMotion = [];
    this.totalMotion = 0;
    this.colorSet = /* @__PURE__ */ new Set();
    this.frameCount = 0;
    this.gradientPixels = 0;
    this.gradientSamples = 0;
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
  addFrame(data) {
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
          Math.abs(data[idx + 2] - this.prevFrame[idx + 2])
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
          data[idx] >> 2 << 12 | data[idx + 1] >> 2 << 6 | data[idx + 2] >> 2
        );
      }
      for (let y = 1; y < this.height - 1; y++) {
        for (let x = 1; x < this.width - 1; x++) {
          const ci = (y * this.width + x) * 4;
          const cr = data[ci], cg = data[ci + 1], cb = data[ci + 2];
          let smooth = true;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const ni = ((y + dy) * this.width + (x + dx)) * 4;
            if (Math.abs(cr - data[ni]) > 3 || Math.abs(cg - data[ni + 1]) > 3 || Math.abs(cb - data[ni + 2]) > 3) {
              smooth = false;
              break;
            }
          }
          if (smooth) this.gradientPixels++;
          this.gradientSamples++;
        }
      }
    }
    this.prevFrame = data;
    this.frameCount++;
  }
  /** Finalize and return the probe result. */
  finalize() {
    const np = this.numPixels;
    const staticMask = new Uint8Array(np);
    let staticCount = 0;
    for (let i = 0; i < np; i++) {
      if (this.maxR[i] - this.minR[i] <= this.tolerance && this.maxG[i] - this.minG[i] <= this.tolerance && this.maxB[i] - this.minB[i] <= this.tolerance) {
        staticMask[i] = 1;
        staticCount++;
      }
    }
    const motionLevel = this.frameCount > 1 ? this.totalMotion / (this.frameCount - 1) : 0;
    const sceneThreshold = 0.6;
    const sceneChanges = [];
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
      gradientDensity: this.gradientSamples > 0 ? this.gradientPixels / this.gradientSamples : 0,
      sceneChanges,
      perFrameMotion: this.perFrameMotion
    };
  }
};

// src/wasm/imagequant-gif/imagequant-gif-wasm.ts
var imagequant_gif_wasm_exports = {};
__export(imagequant_gif_wasm_exports, {
  FrameEncoder: () => FrameEncoder,
  build_shared_palette: () => build_shared_palette,
  downsample_lanczos3: () => downsample_lanczos3,
  quantize_no_dither: () => quantize_no_dither,
  quantize_simple: () => quantize_simple,
  quantize_with_background: () => quantize_with_background,
  remap_with_palette: () => remap_with_palette
});

// src/wasm/imagequant-gif/imagequant_gif_wasm_bg.b64.js
var wasmBase64 = "AGFzbQEAAAAB9wItYAAAYAABf2ABfwBgAX8Bf2ABfwF8YAJ/fwBgAn9/AX9gAn9/AXxgA39/fwBgA39/fwF/YAR/f39/AGAEf39/fwF/YAV/f39/fwBgBX9/f39/AX9gBX9/f39/AX1gBn9/f39/fwBgBn9/f39/fwF/YAd/f39/f39/AGAJf39/f39/f39/AGAKf39/f39/f39/fwBgDX9/f39/f39/f39/f38AYA5/f39/f39/f39/f39/fQBgCn9/f39/f39/f30AYBN/f39/f39/fX1/f39/f39/f39/AGAJf39/f39/fn5+AGAPf39/f399f39/f39/f39/AGAGf39/f31/AX9gBH9/f34AYAV/f398fwBgBX9/f3x8AGADf398AX9gBH9/fH8AYAV/fn5+fgBgAn99AX9gA399fwBgAn98AGADf3x/AX9gBH98f38Bf2ACfX8BfWACfX0BfWADfX19AX1gAXwBfGACfH8BfGACfHwBfGADfHx8AXwChgECGy4vaW1hZ2VxdWFudF9naWZfd2FzbV9iZy5qcydfX3diZ19fX3diaW5kZ2VuX3Rocm93X2VhNDg4N2E1ZjhmOWE5ZGIABRsuL2ltYWdlcXVhbnRfZ2lmX3dhc21fYmcuanMgX193YmluZGdlbl9jYXN0XzAwMDAwMDAwMDAwMDAwMDEABgOlAqMCGQokJQMQHQoKFxEKERoREREIChMJDysDCg8RFRYPJyMJCQkMLAwJHg8OCwgJHwIJBggKCAUpBg8PBQgLDQgGDxwbBQUKBgoFBgkIGAgFCA0LBQUPGQsFBQUCCggGChQUBgwGBwUFDQUFEQ8GDwgICAgFDQUFEggFBQgFAgUICAwMDwgICggIBQgIBQImKgYoCw8CBQsLCAgGCQUFBQUFIAUGBQUFBQUMBQoKBAICCAICCggCBQgFBQYMBQICCAwFCAUDAwMDAwMDAwMGIgkJCAUCBQICAgICDAwGBggIBQUCAgYFBQ0FBQgFAgMDAgUGAgIKBgIIBQICAgEFBggGBQUIBggGBgUACQICAAkDBQAABQUIBgUFBQUsBQIFKycpAAACBAUBcAEkJAUDAQARBhkDfwFBgIDAAAt/AEGM1cAAC38AQfzYwAALB/IGIwZtZW1vcnkCABdfX3diZ19mcmFtZWVuY29kZXJfZnJlZQB1Fl9fd2JnX2ZyYW1lcmVzdWx0X2ZyZWUAdhZfX3diZ19xdWFudHJlc3VsdF9mcmVlAH4UYnVpbGRfc2hhcmVkX3BhbGV0dGUAFRNkb3duc2FtcGxlX2xhbmN6b3MzABwZZnJhbWVlbmNvZGVyX2VuY29kZV9mcmFtZQBWHGZyYW1lZW5jb2Rlcl9lbmNvZGVfa2V5ZnJhbWUAEBBmcmFtZWVuY29kZXJfbmV3AKMBIWZyYW1lZW5jb2Rlcl9wYWxldHRlX3A5NV9kaXN0YW5jZQArH2ZyYW1lZW5jb2Rlcl9zZXRfaW1wb3J0YW5jZV9tYXAAcRxmcmFtZWVuY29kZXJfc2V0X3N0YXRpY19tYXNrAHIXZnJhbWVyZXN1bHRfY3JvcF9oZWlnaHQAxAEWZnJhbWVyZXN1bHRfY3JvcF93aWR0aADFARNmcmFtZXJlc3VsdF9pbmRleGVkAKQBFGZyYW1lcmVzdWx0X2lzX2VtcHR5AMYBEGZyYW1lcmVzdWx0X2xlZnQAxwEZZnJhbWVyZXN1bHRfcGFsZXR0ZV9jb3VudADIARdmcmFtZXJlc3VsdF9wYWxldHRlX3JnYgClARhmcmFtZXJlc3VsdF9wYWxldHRlX3JnYmEApgEPZnJhbWVyZXN1bHRfdG9wAMkBHWZyYW1lcmVzdWx0X3RyYW5zcGFyZW50X2luZGV4AMoBEnF1YW50aXplX25vX2RpdGhlcgBgD3F1YW50aXplX3NpbXBsZQB3GHF1YW50aXplX3dpdGhfYmFja2dyb3VuZABhE3F1YW50cmVzdWx0X2luZGljZXMApwETcXVhbnRyZXN1bHRfcGFsZXR0ZQCoARlxdWFudHJlc3VsdF9wYWxldHRlX2NvdW50AMsBHXF1YW50cmVzdWx0X3RyYW5zcGFyZW50X2luZGV4AMwBEnJlbWFwX3dpdGhfcGFsZXR0ZQAeD19fYWJvcnRfaGFuZGxlcgMBFV9faW5zdGFuY2VfdGVybWluYXRlZAMCH19fd2JpbmRnZW5fYWRkX3RvX3N0YWNrX3BvaW50ZXIAjwIRX193YmluZGdlbl9leHBvcnQAzQESX193YmluZGdlbl9leHBvcnQyAIMCCUUBAEEBCyNe8QEBkAGHAtwBhAKGApYC+wHPAWKKAoACbUDkAfUB1AH4AZwC0AFkjgL+AeABiAKZ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KCApICheGyIoIAlBBGoqAgAgCkEEaioCAJIgJSAlkiIik4siKSAJKgIAIAoqAgCSICQgJJIiKpOLIisgKyArXBsiKyArICkgKSApXBsiKSArICleGyIpICkgKVwbIikgKSAoICggKFwbIiggKSAoXhsiKCAdIBggG0EEdGoiCSoCDCIckiAek4siKSAfIAkqAggiHpIgIJOLIisgKyArXBsiKyArICkgKSApXBsiKSArICleGyIpICEgCSoCBCIgkiAik4siKyAjIAkqAgAiIpIgKpOLIh0gHSAdXBsiHSAdICsgKyArXBsiKyAdICteGyIrICsgK1wbIisgKyApICkgKVwbIikgKyApXhsiKyArICtcGyIpICkgKCAoIChcGyIdICkgHV0bIh8gKyAok4tDAAAAvyApIB0gKSAdXhsiKRCRASIoICggKFwbIiggKCAfIB8gH1wbIisgKCArXhuTIiggKJQiKCAolEMAADBDQwAAoEIQkQEiKPwBQQAgKEMAAAAAYBsgKEMAAH9DXhs6AAAgEyAAakH/AUMAAIA/ICmTQwAAgEOUIij8AUEAIChDAAAAAGAbIChDAAB/Q14bOgAAIAdBEGohByAnIR0gJiEfICUhISAkISMgCCEAIAMgCEYNBQwACwsgGyAXQYTGwAAQ0QEACyAWIBZBlMbAABDRAQALIBkgGUGkxsAAENEBAAsgAyADQbTGwAAQ0QEACyATIANqIRMgFCADaiEUIBchFiAYIQwgGSEXIBohGCAVIA5JDQALCyABQRRqIAUQaSABLQAYIQACQCABKAIUIgpBgICAgHhHDQAgACECDAQLIAYgCyABQRtqLQAAQRh0IAEvABlBCHRyIAByIgkgASgCHCIAIAMgBBA5IAkgACAGIAsgAyAEEDkgBiALIAkgACADIAQQQSAJIAAgBiALIAQgAxBBIAYgCyAJIAAgAyAEEDkgCSAAIAYgCyADIAQQOiAGIAsgCSAAIAMgBBA6IAkgACAGIAsgAyAEEDogDyANIAkgACADIAQQOiAJIAAgDyANIAMgBBA5AkAgCyANIAsgDUkbIgBFDQADQCAPIA8tAAAiByAGLQAAIgggByAISRs6AAAgD0EBaiEPIAZBAWohBiAAQX9qIgANAAsLIAogCUEBQQEQswEMAwtBACAFIA1B9MXAABBcAAtBACAFIAtB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IAMoAgg2AgggACADKQIANwIAIANBEGokAAvzAgEEfwJAAkACQAJAAkACQAJAIAcgCFgNACAHIAh9IAhYDQMCQCAHIAZ9IAZYDQAgByAGQgGGfSAIQgGGWg0DCyAGIAhYDQYgByAGIAh9Igh9IAhWDQYgAyACTQ0BQQAgAyACQbC5wAAQXAALIABBADYCAA8LIAEgA2ohCSADIQoCQAJAA0AgCiILRQ0BIAtBf2oiCiABaiIMLQAAQTlGDQALIAwgDC0AAEEBajoAACADIAtrIgpFDQEgASALakEwIAr8CwAMAQsCQAJAIAMNAEExIQoMAQsgAUExOgAAQTAhCiADQX9qIgtFDQAgAUEBakEwIAv8CwALIARBAWrBIgQgBcFMDQAgAyACTw0AIAkgCjoAACADQQFqIQMLIAMgAksNAgwDCyADIAJNDQJBACADIAJBwLnAABBcAAsgAEEANgIADwtBACADIAJBoLnAABBcAAsgACAEOwEIIAAgAzYCBCAAIAE2AgAPCyAAQQA2AgALigMCCn8GfAJAIAEpAwBCAVINACACKwMAIQ0gASgCPCEDIAEoAjghBCABKAI0IQUgASgCMCEGIAEoAiAhByABKAIcIQggASgCGCEJIAErAxAhDiACKAIQIQogAigCDCELAkAgASgCLCIMRQ0AIAEoAiggDEECdEEBEL8BCwJAIAVFDQAgBiAFQQR0QQQQvwELAkAgA0UNACAEIANBBHRBBBC/AQsCQCAHIAogByAKSRsiA0UNAEEAIQoDQCAIIApqIgdBIGorAwAhDyAHQQhqKwMAIRAgB0EQaisDACERIAdBGGorAwAhEiALIApqIgEgBysDACABKwMAoDkDACABQRhqIgcgEiAHKwMAoDkDACABQRBqIgcgESAHKwMAoDkDACABQQhqIgcgECAHKwMAoDkDACABQSBqIgEgDyABKwMAoDkDACAKQShqIQogA0F/aiIDDQALCyAJIAhBCEEoELMBIAIgDiANoDkDAAsgACACKQMQNwMQIAAgAikDCDcDCCAAIAIpAwA3AwALiQMBBH8gACgCDCECAkACQAJAAkAgAUGAAkkNACAAKAIYIQMCQAJAAkAgAiAARw0AIABBFEEQIAAoAhQiAhtqKAIAIgENAUEAIQIMAgsgACgCCCIBIAI2AgwgAiABNgIIDAELIABBFGog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AUUNASAAKAIQIAFBAnRBARC/AQ8LAkAgACgCCCIBKAIAIgJFDQAgACgCBCACEQIACyABKAIEIgJFDQAgACgCBCACIAEoAggQvwELC6QBAQJ/IwBBIGsiAiQAAkACQCABKAIAQYCAgIB4Rw0AIAIgAS0ABDoACyACQQI2AhwgAiACQQtqNgIYIAJBDGpBqIzAACACQRhqEEwgAigCECIBIAIoAhQQASEDIAIoAgwgAUEBQQEQswEgAEGAgICAeDYCACAAIAM2AgQMAQsgACABKQIQNwIQIAAgASkCCDcCCCAAIAEpAgA3AgALIAJBIGokAAuDAQEDfwJAIANBCEkNACAAIAAgA0EDdiIDQQd0IgRqIAAgA0HgAWwiBWogAxCWASEAIAEgASAEaiABIAVqIAMQlgEhASACIAIgBGogAiAFaiADEJYBIQILIAAgAiABIAAoAhwiAyABKAIcIgRJIgUgBCACKAIcIgZJcxsgBSADIAZJcxsLggEBA38CQCADQQhJDQAgACAAIANBeHEiBGogACADQQN2IgNBDmwiBWogAxCXASEAIAEgASAEaiABIAVqIAMQlwEhASACIAIgBGogAiAFaiADEJcBIQILIAAgAiABIAAvAQAiAyABLwEAIgRJIgUgBCACLwEAIgZJcxsgBSADIAZJcxsLigEBAX8jAEEQayIDJAACQCACIAFqIgEgAk8NAEEAQQAQ/QEACyADQQRqIAAoAgAiAiAAKAIEIAEgAkEBdCICIAEgAksbIgJBCCACQQhLGyICEKsBAkAgAygCBEEBRw0AIAMoAgggAygCDBD9AQALIAMoAgghASAAIAI2AgAgACABNgIEIANBEGokAAuKAQEBfyMAQRBrIgMkAAJAIAIgAWoiASACTw0AQQBBABD9AQALIANBBGogACgCACICIAAoAgQgASACQQF0IgIgASACSxsiAkEIIAJBCEsbIgIQrAECQCADKAIEQQFHDQAgAygCCCADKAIMEP0BAAsgAygCCCEBIAAgAjYCACAAIAE2AgQgA0EQaiQAC4oBAQR/IwBBEGsiAiQAIAJBCGogARC5ASACKAIIIQMCQAJAIAIoAgwiASAAKAIsIAAoAihsRw0AAkAgACgCMCIERQ0AIAAoAjQiBUUNACAEIAVBARC/AQsgACABNgI0IAAgAzYCMEHiACEADAELQegAIQAgAUUNACADIAFBARC/AQsgAkEQaiQAIAALhgEBAn9B5AAhAwJAIAJB/wFxIgQgAUH/AXFJDQAgBEHkAEsNAAJAIAJB/wFxQR5PDQAgACgCKCIDRQ0AIAMgACgCLCIEKAIIQX9qQXhxakEIaiAAQaHKwABBHiAEKAIUEQoACyAAIAIQrQE5AxAgACABEK0BOQMIIABCATcDAEHiACEDCyADC4kBAQJ/IwBBIGsiAiQAAkACQCABKAIAQQNHDQAgAiABLQAEOgALIAJBAjYCHCACIAJBC2o2AhggAkEMakGojMAAIAJBGGoQTCACKAIQIgEgAigCFBABIQMgAigCDCABQQFBARCzASAAQQM2AgAgACADNgIEDAELIAAgAUHYAPwKAAALIAJBIGokAAuFAQEDfyMAQSBrIgIkAAJAAkAgAUH/AXFB4gBHDQBBACEBDAELIAIgAToACyACQQI2AhwgAiACQQtqNgIYIAJBDGpBqIzAACACQRhqEExBASEBIAIoAhAiAyACKAIUEAEhBCACKAIMIANBAUEBELMBCyAAIAQ2AgQgACABNgIAIAJBIGokAAuFAQEDfyMAQSBrIgIkAAJAAkAgAUH/AXFB4gBHDQBBACEBDAELIAIgAToACyACQQI2AhwgAiACQQtqNgIYIAJBDGpBqIzAACACQRhqEExBASEBIAIoAhAiAyACKAIUEAEhBCACKAIMIANBAUEBELMBCyAAIAQ2AgQgACABNgIAIAJBIGokAAuJAQECfyMAQSBrIgIkAAJAAkAgASkDAEICUg0AIAIgAS0ACDoACyACQQI2AhwgAiACQQtqNgIYIAJBDGpBqIzAACACQRhqEEwgAigCECIBIAIoAhQQASEDIAIoAgwgAUEBQQEQswEgAEICNwMAIAAgAzYCCAwBCyAAIAFBuDD8CgAACyACQSBqJAALhQEBA38jAEEgayICJAACQAJAIAFB/wFxQeIARw0AQQAhAQwBCyACIAE6AAsgAkECNgIcIAIgAkELajYCGCACQQxqQaiMwAAgAkEYahBMQQEhASACKAIQIgMgAigCFBABIQQgAigCDCADQQFBARCzAQsgACAENgIEIAAgATYCACACQSBqJAALbgEGfiAAIANC/////w+DIgUgAUL/////D4MiBn4iByADQiCIIgggBn4iBiAFIAFCIIgiCX58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ACABIAMgABC/AQsgAkEQaiQAC3IBAn8jAEEQayIDJAACQCAAKAIAIgRBgAJJDQAgAyABKQIINwMIIAMgASkCADcDAEHwvcAAQSsgA0GcvsAAIAIQwAEACyAAIARBAWo2AgAgACAEQQR0aiIAIAEpAgg3AgwgACABKQIANwIEIANBEGokAAttAQJ/IwBBEGsiAiQAAkACQCABKAIAIAEoAggiA00NACACQQhqIAEgA0EBQQQQggEgAigCCCIDQYGAgIB4Rw0BIAEoAgghAwsgACADNgIEIAAgASgCBDYCACACQRBqJAAPCyADIAIoAgwQ/QEAC20BAn8jAEEQayICJAACQAJAIAEoAgAgASgCCCIDTQ0AIAJBCGogASADQQFBARCCASACKAIIIgNBgYCAgHhHDQEgASgCCCEDCyAAIAM2AgQgACABKAIENgIAIAJBEGokAA8LIAMgAigCDBD9AQALbwEBf0HqACECAkACQCABKAJUDQBB6AAhAiAAKAIoIAEoAihHDQAgACgCLCABKAIsRw0AQdgAEAYiAkUNASACIAFB2AD8CgAAIABB1ABqEPkBIAAgAjYCVEHiAA8LIAEQjQEgAg8LQQhB2AAQkAIAC2wAAkACQAJAIAEoAgBBAkcNACABKAIEIAIgAyAEIAEoAggoAhQRCgAMAQsgBCABKAIIIgNPDQEgASgCBCAEQQJ0aigCACECIAEoAighAwsgACADNgIEIAAgAjYCAA8LIAQgA0HgysAAENEBAAtmAQJ/AkACQAJAIAFFDQAgAUF4aiICIAIoAgBBAWoiAzYCACADRQ0BIAEoAgAiA0H/////B08NAiAAIAI2AgggACABNgIEIAAgAUEEajYCACABIANBAWo2AgAPCxCRAgsACxCSAgALZgEBfyAAKAIMIABBEGooAgBBAUEBELMBIAAoAhggAEEcaigCAEEBQQEQswEgACgCJCAAQShqKAIAQQFBARCzAQJAIABBf0YNACAAIAAoAgRBf2oiATYCBCABDQAgAEE4QQQQvwELC2cBAX8gACgCDCAAQRBqKAIAQQFBARCzASAAKAIYIABBHGooAgBBAUEBELMBIAAoAiQgAEEoaigCAEEBQQEQswECQCAAQX9GDQAgACAAKAIEQX9qIgE2AgQgAQ0AIABBzABBBBC/AQsLYgECfwJAAkAgAEF8aigCACIDQXhxIgRBBEEIIANBA3EiAxsgAWpJDQACQCADRQ0AIAQgAUEnaksNAgsgABAwDwtBmM7AAEEuQcjOwAAQ/wEAC0HYzsAAQS5BiM/AABD/AQALWgEBfyMAQSBrIgUkACAFIAE2AgQgBSAANgIAIAUgAzYCDCAFIAI2AgggBUEHrUIghiAFQQhqrYQ3AxggBUEIrUIghiAFrYQ3AxBBpIzAACAFQRBqIAQQ3gEAC18BA38jAEEQayICJAAgAkEEaiABQQFBAUEBEIEBIAIoAgghAwJAIAIoAgRBAUcNACADIAIoAgwQ/QEACyACKAIMIQQgACABNgIIIAAgBDYCBCAAIAM2AgAgAkEQaiQAC2IBAX8CQAJAIAJFDQAgAhAGIgNFDQEgAEEANgIIIAAgAzYCBCAAIAI2AgACQCACRQ0AIAMgASAC/AoAAAsgACACNgIIDwsgAEEANgIIIABCgICAgBA3AgAPC0EBIAIQ/QEAC1oBAn8CQAJAAkAgAUUNACABQXhqIgIgAigCAEEBaiIDNgIAIANFDQEgASgCAA0CIAAgAjYCCCAAIAE2AgQgAUF/NgIAIAAgAUEEajYCAA8LEJECCwALEJICAAtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAI4IQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAEL4BCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAI0IQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAEL4BCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIELQA8IQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAEL4BCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAIsIQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAEL4BCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAIkIQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAEL4BCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAIwIQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAEL4BCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAIoIQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAEL4BCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAIYIQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAENUBCyABQRBqJAAgAgtcAQN/IwBBEGsiASQAIAFBBGogABC8ASABKAIEKAIcIQIgASgCCCIAIAAoAgBBf2o2AgAgASgCDCIAIAAoAgBBf2oiAzYCAAJAIAMNACAAENUBCyABQRBqJAAgAgtTAQF/AkAgAWlBAUcNAEEAIAEgAEGAgICAeCABa0sbIgJFDQACQCAARQ0AAkACQCACQQlJDQAgAiAAEEohAQwBCyAAEAYhAQsgAUUNAQsgAQ8LAAtZAQJ/IwBBEGsiAyQAAkAgACgCACIEQYACSQ0AIAMgATgCDEHwvcAAQSsgA0EMakHgvcAAIAIQwAEACyAAIARBAWo2AgAgACAEQQJ0aiABOAIEIANBEGokAAtXAQF/AkACQAJAIAIgACgCACAAKAIIIgNrTQ0AIAAgAyACEJgBIAAoAgghAwwBCyACRQ0BCyACRQ0AIAAoAgQgA2ogASAC/AoAAAsgACADIAJqNgIIQQALVwEBfwJAAkACQCACIAAoAgAgACgCCCIDa00NACAAIAMgAhCZASAAKAIIIQMMAQsgAkUNAQsgAkUNACAAKAIEIANqIAEgAvwKAAALIAAgAyACajYCCEEAC08CAX8BfiMAQSBrIgMkACADIAE2AgwgAyAANgIIIANBAa1CIIYiBCADQQhqrYQ3AxggAyAEIANBDGqthDcDEEH4icAAIANBEGogAhDeAQALUgIBfwF+IwBBIGsiAiQAIAIgATYCDCACIAA2AgggAkEBrUIghiIDIAJBDGqthDcDGCACIAMgAkEIaq2ENwMQQcCjwAAgAkEQakGgpMAAEN4BAAtJAQN/AkAgACgCECIBRQ0AIAEgACgCCCICIAAoAgQgAUEBamxqQX9qQQAgAmtxIgNqQQlqIgFFDQAgACgCDCADayABIAIQvwELC1YBAn8gASgCACECIAFBADYCAAJAAkAgAkUNACABKAIEIQNBCBAGIgFFDQEgASADNgIEIAEgAjYCACAAQcTPwAA2AgQgACABNgIADwsAC0EEQQgQkAIAC1IBAX8gACgCDCAAQRBqKAIAQQFBARCzASAAKAIYIABBHGooAgBBAUEBELMBAkAgAEF/Rg0AIAAgACgCBEF/aiIBNgIEIAENACAAQSxBBBC/AQsLRwEBfyMAQRBrIgEkACABQQhqIAAgACgCAEEBQQFBBBCDAQJAIAEoAggiAEGBgICAeEYNACAAIAEoAgwQ/QEACyABQRBqJAALRwEBfyMAQRBrIgEkACABQQhqIAAgACgCAEEBQQRBBBCDAQJAIAEoAggiAEGBgICAeEYNACAAIAEoAgwQ/QEACyABQRBqJAALRwEBfyMAQRBrIgEkACABQQhqIAAgACgCAEEBQQRBEBCDAQJAIAEoAggiAEGBgICAeEYNACAAIAEoAgwQ/QEACyABQRBqJAALRwEBfyMAQRBrIgEkACABQQhqIAAgACgCAEEBQQJBAhCDAQJAIAEoAggiAEGBgICAeEYNACAAIAEoAgwQ/QEACyABQRBqJAALQAEBfyMAQSBrIgUkACAFQQhqIAIQuAEgBUEBNgIUIAUgBSkDCDcCGCAAIAEgBUEUaiADIAQgAxAqIAVBIGokAAtEAQF/IwBBEGsiBSQAIAVBCGogACABIAIgAyAEEIMBAkAgBSgCCCIEQYGAgIB4Rg0AIAQgBSgCDBD9AQALIAVBEGokAAtGAgJ/AXwgASgCCCICQYCAgAFxIQMgACsDACEEAkAgAkGAgICAAXENACABIAQgA0EARxAEDwsgASAEIANBAEcgAS8BDhAFC0wAAkAgACgCAEGAgICAeEYNACABKAIAIAAoAgQgACgCCCABKAIEKAIMEQkADwsgASgCACABKAIEIAAoAgwoAgAiACgCACAAKAIEED0LPAEBfyMAQSBrIgMkACADIAE2AhAgAyAANgIMIANBATsBHCADIAI2AhggAyADQQxqNgIUIANBFGoQ7wEACzoBAX8jAEEQayIDJAAgAyABNgIEIAMgADYCACADQQitQiCGIAOthDcDCEGojMAAIANBCGogAhDeAQALRAECfyABKAIEIQIgASgCACEDAkBBCBAGIgENAEEEQQgQkAIACyABIAI2AgQgASADNgIAIABBxM/AADYCBCAAIAE2AgALPQEBfwJAAkAgAQ0AQQEhAkEAIQEMAQsgARAGIgINAEEBIAEQ/QEACyAAQQA2AgggACACNgIEIAAgATYCAAs8AQF/AkAgACgCBCIBRQ0AIAAoAgAgAUEFdEEEEL8BCwJAIAAoAgwiAUUNACAAKAIIIAFBBHRBBBC/AQsLQAEBfwJAIAAoAhAiAUUNACABEOMBIAFBJEEEEL8BIAAoAhQiABDjASAAQSRBBBC/AQ8LIAAoAhRB4ABBBBC/AQs/AQF/IwBBEGsiAiQAIAJBBTYCDCACQdjLwAA2AgggASgCACABKAIEQZKMwAAgAkEIahA9IQEgAkEQaiQAIAELMAEBfwJAIAFFDQAgASABQQVsQQxqQXhxIgJqQQlqIgFFDQAgACACayABQQgQvwELCzABAX8CQCABRQ0AIAEgAUEMbEETakF4cSICakEJaiIBRQ0AIAAgAmsgAUEIEL8BCws5AAJAIAJBgIDEAEYNACAAIAIgASgCEBEGAEUNAEEBDwsCQCADDQBBAA8LIAAgAyAEIAEoAgwRCQALMQACQCABRQ0AA0AgACgCACAAQQRqKAIAQQRBBBCzASAAQRBqIQAgAUF/aiIBDQALCws2AQF/AkAgAEUNAAJAIAEoAgAiAkUNACAAIAIRAgALIAEoAgQiAkUNACAAIAIgASgCCBC/AQsLNQEBfyMAQRBrIgMkACADIAE2AgwgAyAANgIIIANBCGpBhKbAACADQQxqQYSmwAAgAhCpAQALOAEBfyMAQRBrIgIkACACIAE2AgwgAiAANgIIIAJBCGpBlKbAACACQQxqQZSmwABB5KbAABCpAQALLAEBfyMAQRBrIgEkACABQQmtQiCGIAFBD2qthDcDAEGojMAAIAEgABDeAQALNAEBfwJAQcwAEAYiAQ0AQQRBzAAQkAIACyABQoGAgIAQNwIAIAFBCGogAEHEAPwKAAAgAQsxAQF/AkBBLBAGIgENAEEEQSwQkAIACyABQoGAgIAQNwIAIAFBCGogAEEk/AoAACABCy0CAX8BfiMAQRBrIgEkACAAKQIAIQIgASAANgIMIAEgAjcCBCABQQRqEJ0CAAstAQF/IwBBEGsiAiQAIAIgATYCDCACIAA2AgggAkEIakGMzcAAQQFBABCGAQALMAAgASgCACAALQAAQZ1/akH/AXFBAnQiACgCyNFAIAAoAqjRQCABKAIEKAIMEQkACygBAX8CQCAAKAIARQ0AIAAoAggiAUUNACAAKAIEIAFBAnRBARC/AQsLLQEBfwJAIAAoAgBFDQAgACgCGCIBQYCAgIB4Rg0AIAEgACgCHEEIQSgQswELCyIAIAAgAiADED8gAEEQaiACQRBqIAMQPyACQQggASADEEgLKgEBfwJAIAAoAgAiAkUNACABKAIAIAIgACgCBCABKAIEKAIMEQkADwsACycBAX8CQCAAKAIADQAgACgCCCIBRQ0AIAAoAgQgAUECdEEEEL8BCwscACAAIAIQcyAAQRBqIAJBEGoQcyACQQggARBdCyAAAkAgASgCAEUNACAAQcTPwAA2AgQgACABNgIADwsACx4AAkAgACgCACIARQ0AIAAQjQEgAEHYAEEIEL8BCwsfAQF/AkAgACgCACIBQQFIDQAgACgCBCABQQEQvwELCx0BAX8CQCAAKAIAIgFFDQAgACgCBCABQQEQvwELCxkBAX8CQEEBEAYiAA0AQQFBARCQAgALIAALFgACQCAARQ0AIAAgARCQAgALEIkCAAscACABKAIAIAAoAgAgACgCBCABKAIEKAIMEQkACxIAIAAgAUEBdEEBciACEN4BAAsZACABKAIAQcClwABBBSABKAIEKAIMEQkACxoAIABBACkCgM5ANwIIIABBACkC+M1ANwIACxoAIABBACkCkM5ANwIIIABBACkCiM5ANwIACxMAAkAgAUUNACAAIAEgAhC/AQsLFAAgACgCACABIAAoAgQoAgwRBgALEAAgACACNgIEIAAgATYCAAsQACABIAAoAgAgACgCBBAoCxAAIAEgACgCACAAKAIEECgLEwAgAEHEz8AANgIEIAAgATYCAAsSAEGsvsAAQSNBkKTAABDeAQALDwAgAEGwpMAAIAEgAhA9Cw8AQcWlwABBLyAAEJUCAAsPAEHkqcAAQTMgABDeAQALEwBB4KrAAEGZAUGsq8AAEN4BAAsPACAAQajNwAAgASACED0LCwAgACMAaiQAIwALCgAgASAAEJQCAAsNAEG80MAAQRsQkwIACw4AQdfQwABBzwAQkwIACwoAIAAgARCeAgALCgAgASAAEJoCAAsKACAAIAEQlwIACw0AIAFB4rnAAEEYECgLCgAgACABEPABAAsMAEEAQQE6AOTYQAALDAAgACABKQIANwMACwoAIAAgARCYAgALCgAgACABIAIQJgsJACAAQQA2AgALCAAgABCvAQALCAAgACABEAALCAAgACABEBgLCAAgACABECALBgAgABA3CwMAAAsCAAsCAAsLolUCAEGAgMAAC4hVcmdiYSBzaXplIG1pc21hdGNoAAAAAAAASBEQAAoAAADjAgAAFAAAAEgREAAKAAAA4wIAAEcAAABIERAACgAAANECAAAoAAAASBEQAAoAAADSAgAAJQAAAEgREAAKAAAA1QIAACAAAABIERAACgAAANYCAAAgAAAASBEQAAoAAADXAgAAIAAAAEgREAAKAAAA2AIAACAAAABIERAACgAAALYCAAAsAAAASBEQAAoAAACUAgAALQAAAEgREAAKAAAAlwIAAB4AAABIERAACgAAAJcCAAAzAAAASBEQAAoAAACYAgAAHgAAAEgREAAKAAAAmAIAADcAAABIERAACgAAAJkCAAAeAAAASBEQAAoAAACZAgAANwAAAEgREAAKAAAArAIAACAAAABIERAACgAAAKICAAAxAAAASBEQAAoAAAClAgAAIgAAAEgREAAKAAAApQIAADgAAABIERAACgAAAKYCAAAiAAAASBEQAAoAAACmAgAAPAAAAEgREAAKAAAApwIAACIAAABIERAACgAAAKcCAAA8AAAASBEQAAoAAABqAgAALgAAAEgREAAKAAAA2gEAABUAAABIERAACgAAAN0BAAAwAAAASBEQAAoAAADeAQAANAAAAEgREAAKAAAA3wEAADQAAABIERAACgAAAOIBAAAeAAAASBEQAAoAAADqAQAAIgAAAEgREAAKAAAA6wEAACIAAABIERAACgAAAOwBAAAiAAAASBEQAAoAAADSAQAAGAAAAEgREAAKAAAAzQEAACgAAABIERAACgAAAM0BAAA7AAAASBEQAAoAAADNAQAAUgAAAEgREAAKAAAAtQEAABYAAABIERAACgAAAH8BAAAdAAAASBEQAAoAAACBAQAAJgAAAEgREAAKAAAAgQEAABgAAABIERAACgAAAIIBAAAYAAAASBEQAAoAAACDAQAAGAAAAEgREAAKAAAAhAEAABgAAABIERAACgAAAAoDAAAWAAAASBEQAAoAAAALAwAAFgAAAEgREAAKAAAADAMAABYAAABIERAACgAAABADAAAmAAAASBEQAAoAAAARAwAAJAAAAEgREAAKAAAAEgMAACQAAABIERAACgAAAI4DAAAJAAAASBEQAAoAAABKAwAADQAAAEgREAAKAAAAZgMAABEAAABIERAACgAAAFsDAAAkAAAASBEQAAoAAAB5AwAADQAAAEgREAAKAAAATQMAAEEAAABwYWxldHRlIG11c3QgYmUgbm9uLWVtcHR5IFJHQkEAAEgREAAKAAAA/AMAABsAAABIERAACgAAABMEAAAUAAAASBEQAAoAAAAUBAAAFAAAAEgREAAKAAAAFQQAABQAAABIERAACgAAABYEAAAUAAAASBEQAAoAAAAIBAAAHQAAAEgREAAKAAAA7wMAABQAAABIERAACgAAAPADAAAUAAAASBEQAAoAAADxAwAAFAAAAEgREAAKAAAA8gMAABQAAABIERAACgAAAOQDAAAaAAAASBEQAAoAAACtAAAALAAAAGZyYW1lc19yZ2JhIHNpemUgbWlzbWF0Y2hhdHRlbXB0ZWQgdG8gdGFrZSBvd25lcnNoaXAgb2YgUnVzdCB2YWx1ZSB3aGlsZSBpdCB3YXMgYm9ycm93ZWQWc2xpY2UgaW5kZXggc3RhcnRzIGF0IMANIGJ1dCBlbmRzIGF0IMAAIGluZGV4IG91dCBvZiBib3VuZHM6IHRoZSBsZW4gaXMgwBIgYnV0IHRoZSBpbmRleCBpcyDAABJyYW5nZSBzdGFydCBpbmRleCDAIiBvdXQgb2YgcmFuZ2UgZm9yIHNsaWNlIG9mIGxlbmd0aCDAABByYW5nZSBlbmQgaW5kZXggwCIgb3V0IG9mIHJhbmdlIGZvciBzbGljZSBvZiBsZW5ndGggwAAZcGFydGl0aW9uX2F0X2luZGV4IGluZGV4IMAeIGdyZWF0ZXIgdGhhbiBsZW5ndGggb2Ygc2xpY2UgwAAQYXNzZXJ0aW9uIGBsZWZ0IMAXIHJpZ2h0YCBmYWlsZWQKICBsZWZ0OiDACQogcmlnaHQ6IMAAD0NhcGFjaXR5RXJyb3I6IMAAwAI6IMAAKSAgZWxpbWluYXRlZCBvcGFxdWUgdFJOUy1jaHVuayBlbnRyaWVzLi4uwAUgZW50csAMIHRyYW5zcGFyZW50AC9Vc2Vycy9nYWJyaWVsZWxvc3VyZG8vLmNhcmdvL3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9pbWFnZXF1YW50LTQuNC4xL3NyYy9zZWFjb3cucnMAL3J1c3RjL2FjNjhmYWEyMGM1OGNiY2NkMDFlZTcyMDhiZjNiNmU5M2E3ZDdmOTYvbGlicmFyeS9jb3JlL3NyYy9udW0vaW1wL2ZsdDJkZWMvc3RyYXRlZ3kvZ3Jpc3UucnMAL1VzZXJzL2dhYnJpZWxlbG9zdXJkby8uY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2ltYWdlcXVhbnQtNC40LjEvc3JjL21lZGlhbmN1dC5ycwAvVXNlcnMvZ2FicmllbGVsb3N1cmRvLy5jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvaW1hZ2VxdWFudC00LjQuMS9zcmMvaGlzdC5ycwAvVXNlcnMvZ2FicmllbGVsb3N1cmRvLy5jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvaW1hZ2VxdWFudC00LjQuMS9zcmMvbmVhcmVzdC5ycwAvcnVzdGMvYWM2OGZhYTIwYzU4Y2JjY2QwMWVlNzIwOGJmM2I2ZTkzYTdkN2Y5Ni9saWJyYXJ5L2NvcmUvc3JjL3NsaWNlL3NvcnQvc2hhcmVkL3NtYWxsc29ydC5ycwAvcnVzdGMvYWM2OGZhYTIwYzU4Y2JjY2QwMWVlNzIwOGJmM2I2ZTkzYTdkN2Y5Ni9saWJyYXJ5L2NvcmUvc3JjL3NsaWNlL3NvcnQvc3RhYmxlL3F1aWNrc29ydC5ycwAvVXNlcnMvZ2FicmllbGVsb3N1cmRvLy5jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvaW1hZ2VxdWFudC00LjQuMS9zcmMvcXVhbnQucnMAL3J1c3RjL2FjNjhmYWEyMGM1OGNiY2NkMDFlZTcyMDhiZjNiNmU5M2E3ZDdmOTYvbGlicmFyeS9hbGxvYy9zcmMvZm10LnJzAC9ydXN0Yy9hYzY4ZmFhMjBjNThjYmNjZDAxZWU3MjA4YmYzYjZlOTNhN2Q3Zjk2L2xpYnJhcnkvY29yZS9zcmMvc2xpY2Uvc29ydC9zZWxlY3QucnMAL3J1c3RjL2FjNjhmYWEyMGM1OGNiY2NkMDFlZTcyMDhiZjNiNmU5M2E3ZDdmOTYvbGlicmFyeS9jb3JlL3NyYy9udW0vaW1wL2RpeV9mbG9hdC5ycwAvVXNlcnMvZ2FicmllbGVsb3N1cmRvLy5jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvaW1hZ2VxdWFudC00LjQuMS9zcmMvcm93cy5ycwAvVXNlcnMvZ2FicmllbGVsb3N1cmRvLy5jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvaW1hZ2VxdWFudC00LjQuMS9zcmMva21lYW5zLnJzAC9ydXN0Yy9hYzY4ZmFhMjBjNThjYmNjZDAxZWU3MjA4YmYzYjZlOTNhN2Q3Zjk2L2xpYnJhcnkvc3RkL3NyYy9zeXMvc3luYy9yd2xvY2svbm9fdGhyZWFkcy5ycwAvVXNlcnMvZ2FicmllbGVsb3N1cmRvLy5jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvaW1hZ2VxdWFudC00LjQuMS9zcmMvYmx1ci5ycwAvcnVzdGMvYWM2OGZhYTIwYzU4Y2JjY2QwMWVlNzIwOGJmM2I2ZTkzYTdkN2Y5Ni9saWJyYXJ5L2NvcmUvc3JjL3NsaWNlL2l0ZXIucnMAL1VzZXJzL2dhYnJpZWxlbG9zdXJkby8uY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2ltYWdlcXVhbnQtNC40LjEvc3JjL3JlbWFwLnJzAC9ydXN0Yy9hYzY4ZmFhMjBjNThjYmNjZDAxZWU3MjA4YmYzYjZlOTNhN2Q3Zjk2L2xpYnJhcnkvY29yZS9zcmMvbnVtL2ltcC9mbHQyZGVjL3N0cmF0ZWd5L2RyYWdvbi5ycwAvcnVzdGMvYWM2OGZhYTIwYzU4Y2JjY2QwMWVlNzIwOGJmM2I2ZTkzYTdkN2Y5Ni9saWJyYXJ5L2NvcmUvc3JjL251bS9pbXAvYmlnbnVtLnJzAC9Vc2Vycy9nYWJyaWVsZWxvc3VyZG8vLmNhcmdvL3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9pbWFnZXF1YW50LTQuNC4xL3NyYy9wYWwucnMAL1VzZXJzL2dhYnJpZWxlbG9zdXJkby8uY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL3dhc20tYmluZGdlbi0wLjIuMTI1L3NyYy9leHRlcm5yZWYucnMAL1VzZXJzL2dhYnJpZWxlbG9zdXJkby8uY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2ltYWdlcXVhbnQtNC40LjEvc3JjL2ltYWdlLnJzAC9ydXN0Yy9hYzY4ZmFhMjBjNThjYmNjZDAxZWU3MjA4YmYzYjZlOTNhN2Q3Zjk2L2xpYnJhcnkvYWxsb2Mvc3JjL3NsaWNlLnJzAC9ydXN0L2RlcHMvaGFzaGJyb3duLTAuMTYuMS9zcmMvcmF3L21vZC5ycwAvcnVzdGMvYWM2OGZhYTIwYzU4Y2JjY2QwMWVlNzIwOGJmM2I2ZTkzYTdkN2Y5Ni9saWJyYXJ5L2FsbG9jL3NyYy9yYXdfdmVjL21vZC5ycwAvcnVzdGMvYWM2OGZhYTIwYzU4Y2JjY2QwMWVlNzIwOGJmM2I2ZTkzYTdkN2Y5Ni9saWJyYXJ5L2FsbG9jL3NyYy92ZWMvbW9kLnJzAC9ydXN0Yy9hYzY4ZmFhMjBjNThjYmNjZDAxZWU3MjA4YmYzYjZlOTNhN2Q3Zjk2L2xpYnJhcnkvY29yZS9zcmMvbnVtL2ltcC9mbHQyZGVjL21vZC5ycwAvcnVzdC9kZXBzL2RsbWFsbG9jLTAuMi4xMS9zcmMvZGxtYWxsb2MucnMAL1VzZXJzL2dhYnJpZWxlbG9zdXJkby8uY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2FycmF5dmVjLTAuNy43L3NyYy9hcnJheXZlYy5ycwAvVXNlcnMvZ2FicmllbGVsb3N1cmRvLy5jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2Yvb25jZV9jZWxsLTEuMjEuNC9zcmMvbGliLnJzABFCdWZmZXIgbGVuZ3RoIGlzIMAgIGJ5dGVzLCB3aGljaCBpcyBub3QgZW5vdWdoIGZvciDAAsOXwA7DlzQgUkdCQSBieXRlcwATICBtYWRlIGhpc3RvZ3JhbS4uLsANIGNvbG9ycyBmb3VuZAAWc3dhcF9yZW1vdmUgaW5kZXggKGlzIMAWKSBzaG91bGQgYmUgPCBsZW4gKGlzIMABKQAVICBzZWxlY3RpbmcgY29sb3JzLi4uwAElAAAAAF8PEABQAAAAHAAAAAUAAACwDxAATAAAALQIAAANAAAACgAAAAwAAAAEAAAACwAAAAwAAAANAAAAAAAAAAAAAAABAAAADgAAAGEgZm9ybWF0dGluZyB0cmFpdCBpbXBsZW1lbnRhdGlvbiByZXR1cm5lZCBhbiBlcnJvciB3aGVuIHRoZSB1bmRlcmx5aW5nIHN0cmVhbSBkaWQgbm90AAClCRAASAAAAI8CAAAOAAAARXJyb3JBcnJheVZlYzogY2FwYWNpdHkgZXhjZWVkZWQgaW4gZXh0ZW5kL2Zyb21faXRlcjAxMjM0NTY3ODlhYmNkZWYAAAAABAAAAAQAAAAPAAAAAAAAAAQAAAAEAAAAEAAAAC0rTmFOaW5mMDAuYXNzZXJ0aW9uIGZhaWxlZDogYnVmLmxlbigpID49IG1heGxlbv0PEABXAAAAiwIAAA0AAABEChAAVQAAAC4AAAAJAAAAYXNzZXJ0aW9uIGZhaWxlZDogb3RoZXIgPiAwYXNzZXJ0aW9uIGZhaWxlZDogbm9ib3Jyb3cAAABSDRAAUgAAAIQBAAABAAAAYXNzZXJ0aW9uIGZhaWxlZDogZGlnaXRzIDwgNDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwPT0wMDAxMDIwMzA0MDUwNjA3MDgwOTEwMTExMjEzMTQxNTE2MTcxODE5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";

// src/wasm/imagequant-gif/imagequant-gif-wasm.ts
var wasm;
var cachedUint8 = null;
var cachedDataView = null;
var WASM_VECTOR_LEN = 0;
var heap = new Array(1024).fill(void 0);
heap.push(void 0, null, true, false);
var heapNext = heap.length;
function addHeapObject(obj) {
  if (heapNext === heap.length) heap.push(heap.length + 1);
  const idx = heapNext;
  heapNext = heap[idx];
  heap[idx] = obj;
  return idx;
}
function getObject(idx) {
  return heap[idx];
}
function dropObject(idx) {
  if (idx < 1028) return;
  heap[idx] = heapNext;
  heapNext = idx;
}
function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
var textDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
textDecoder.decode();
function getUint8() {
  if (!cachedUint8 || cachedUint8.byteLength === 0)
    cachedUint8 = new Uint8Array(wasm.memory.buffer);
  return cachedUint8;
}
function getDataView() {
  if (!cachedDataView || cachedDataView.buffer.detached === true || cachedDataView.buffer.detached === void 0 && cachedDataView.buffer !== wasm.memory.buffer)
    cachedDataView = new DataView(wasm.memory.buffer);
  return cachedDataView;
}
function getStringFromWasm(ptr, len) {
  return textDecoder.decode(getUint8().subarray(ptr >>> 0, (ptr >>> 0) + len));
}
function getArrayU8(ptr, len) {
  return getUint8().subarray(ptr >>> 0, (ptr >>> 0) + len);
}
function passArray8(arg) {
  const ptr = wasm.__wbindgen_export(arg.length, 1) >>> 0;
  getUint8().set(arg, ptr);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
var QuantResultFin = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_quantresult_free(ptr, 1));
var QuantResultImpl = class _QuantResultImpl {
  constructor(ptr) {
    this.__wbg_ptr = ptr;
  }
  static __wrap(ptr) {
    const obj = new _QuantResultImpl(ptr);
    QuantResultFin.register(obj, ptr, obj);
    return obj;
  }
  free() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    QuantResultFin.unregister(this);
    wasm.__wbg_quantresult_free(ptr, 0);
  }
  get indices() {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      wasm.quantresult_indices(retptr, this.__wbg_ptr);
      return getArrayU8(
        getDataView().getInt32(retptr, true),
        getDataView().getInt32(retptr + 4, true)
      ).slice();
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  get palette() {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      wasm.quantresult_palette(retptr, this.__wbg_ptr);
      return getArrayU8(
        getDataView().getInt32(retptr, true),
        getDataView().getInt32(retptr + 4, true)
      ).slice();
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  get palette_count() {
    return wasm.quantresult_palette_count(this.__wbg_ptr) >>> 0;
  }
  get transparent_index() {
    return wasm.quantresult_transparent_index(this.__wbg_ptr);
  }
};
var FrameResultFin = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_frameresult_free(ptr, 1));
var FrameResultImpl = class _FrameResultImpl {
  constructor(ptr) {
    this.__wbg_ptr = ptr;
  }
  static __wrap(ptr) {
    const obj = new _FrameResultImpl(ptr);
    FrameResultFin.register(obj, ptr, obj);
    return obj;
  }
  free() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    FrameResultFin.unregister(this);
    wasm.__wbg_frameresult_free(ptr, 0);
  }
  get indexed() {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      wasm.frameresult_indexed(retptr, this.__wbg_ptr);
      return getArrayU8(
        getDataView().getInt32(retptr, true),
        getDataView().getInt32(retptr + 4, true)
      ).slice();
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  get palette_rgb() {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      wasm.frameresult_palette_rgb(retptr, this.__wbg_ptr);
      return getArrayU8(
        getDataView().getInt32(retptr, true),
        getDataView().getInt32(retptr + 4, true)
      ).slice();
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  get palette_rgba() {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      wasm.frameresult_palette_rgba(retptr, this.__wbg_ptr);
      return getArrayU8(
        getDataView().getInt32(retptr, true),
        getDataView().getInt32(retptr + 4, true)
      ).slice();
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  get palette_count() {
    return wasm.frameresult_palette_count(this.__wbg_ptr) >>> 0;
  }
  get transparent_index() {
    return wasm.frameresult_transparent_index(this.__wbg_ptr);
  }
  get left() {
    return wasm.frameresult_left(this.__wbg_ptr) >>> 0;
  }
  get top() {
    return wasm.frameresult_top(this.__wbg_ptr) >>> 0;
  }
  get crop_width() {
    return wasm.frameresult_crop_width(this.__wbg_ptr) >>> 0;
  }
  get crop_height() {
    return wasm.frameresult_crop_height(this.__wbg_ptr) >>> 0;
  }
  get is_empty() {
    return wasm.frameresult_is_empty(this.__wbg_ptr) !== 0;
  }
};
var FrameEncoderFin = typeof FinalizationRegistry === "undefined" ? { register: () => {
}, unregister: () => {
} } : new FinalizationRegistry((ptr) => wasm.__wbg_frameencoder_free(ptr, 1));
var FrameEncoder = class {
  constructor(width, height) {
    ensureWasm();
    this.__wbg_ptr = wasm.frameencoder_new(width, height);
    FrameEncoderFin.register(this, this.__wbg_ptr, this);
  }
  free() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    FrameEncoderFin.unregister(this);
    wasm.__wbg_frameencoder_free(ptr, 0);
  }
  set_static_mask(mask) {
    const p0 = passArray8(mask), l0 = WASM_VECTOR_LEN;
    wasm.frameencoder_set_static_mask(this.__wbg_ptr, p0, l0);
  }
  set_importance_map(map) {
    const p0 = passArray8(map), l0 = WASM_VECTOR_LEN;
    wasm.frameencoder_set_importance_map(this.__wbg_ptr, p0, l0);
  }
  encode_keyframe(rgba, quality, speed, max_colors) {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
      wasm.frameencoder_encode_keyframe(retptr, this.__wbg_ptr, p0, l0, quality, speed, max_colors);
      const r0 = getDataView().getInt32(retptr, true);
      const r1 = getDataView().getInt32(retptr + 4, true);
      const r2 = getDataView().getInt32(retptr + 8, true);
      if (r2) throw takeObject(r1);
      return FrameResultImpl.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  encode_frame(rgba, stale_threshold, frame_motion, is_quality, next_frame, remap_palette, quality, speed, max_colors, sparse_radius) {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
      const p1 = passArray8(next_frame), l1 = WASM_VECTOR_LEN;
      const p2 = passArray8(remap_palette), l2 = WASM_VECTOR_LEN;
      wasm.frameencoder_encode_frame(
        retptr,
        this.__wbg_ptr,
        p0,
        l0,
        stale_threshold,
        frame_motion,
        is_quality,
        p1,
        l1,
        p2,
        l2,
        quality,
        speed,
        max_colors,
        sparse_radius
      );
      const r0 = getDataView().getInt32(retptr, true);
      const r1 = getDataView().getInt32(retptr + 4, true);
      const r2 = getDataView().getInt32(retptr + 8, true);
      if (r2) throw takeObject(r1);
      return FrameResultImpl.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  palette_p95_distance(rgba, palette_rgba) {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    const p1 = passArray8(palette_rgba), l1 = WASM_VECTOR_LEN;
    return wasm.frameencoder_palette_p95_distance(this.__wbg_ptr, p0, l0, p1, l1);
  }
};
function ensureWasm() {
  if (wasm) return;
  const binaryString = typeof atob === "function" ? atob(wasmBase64) : Buffer.from(wasmBase64, "base64").toString("binary");
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const imports = {
    "./imagequant_gif_wasm_bg.js": {
      __wbg___wbindgen_throw_ea4887a5f8f9a9db(arg0, arg1) {
        throw new Error(getStringFromWasm(arg0, arg1));
      },
      __wbindgen_cast_0000000000000001(arg0, arg1) {
        return addHeapObject(getStringFromWasm(arg0, arg1));
      }
    }
  };
  const mod = new WebAssembly.Module(bytes);
  wasm = new WebAssembly.Instance(mod, imports).exports;
}
function quantize_with_background(rgba, w, h, qmin, qmax, speed, maxColors, bg, imp) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    const p1 = passArray8(bg), l1 = WASM_VECTOR_LEN;
    const p2 = passArray8(imp), l2 = WASM_VECTOR_LEN;
    wasm.quantize_with_background(retptr, p0, l0, w, h, qmin, qmax, speed, maxColors, p1, l1, p2, l2);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function quantize_simple(rgba, w, h, qmin, qmax, speed, maxColors) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    wasm.quantize_simple(retptr, p0, l0, w, h, qmin, qmax, speed, maxColors);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function quantize_no_dither(rgba, w, h, qmin, qmax, speed, maxColors, bg, imp) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    const p1 = passArray8(bg), l1 = WASM_VECTOR_LEN;
    const p2 = passArray8(imp), l2 = WASM_VECTOR_LEN;
    wasm.quantize_no_dither(retptr, p0, l0, w, h, qmin, qmax, speed, maxColors, p1, l1, p2, l2);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function build_shared_palette(framesRgba, w, h, frameCount, qmin, qmax, speed, maxColors) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(framesRgba), l0 = WASM_VECTOR_LEN;
    wasm.build_shared_palette(retptr, p0, l0, w, h, frameCount, qmin, qmax, speed, maxColors);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    const r3 = getDataView().getInt32(retptr + 12, true);
    if (r3) throw takeObject(r2);
    const v = getArrayU8(r0, r1).slice();
    wasm.__wbindgen_export2(r0, r1, 1);
    return v;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function remap_with_palette(rgba, w, h, palette, bg, dither) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(rgba), l0 = WASM_VECTOR_LEN;
    const p1 = passArray8(palette), l1 = WASM_VECTOR_LEN;
    const p2 = passArray8(bg), l2 = WASM_VECTOR_LEN;
    wasm.remap_with_palette(retptr, p0, l0, w, h, p1, l1, p2, l2, dither);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const r2 = getDataView().getInt32(retptr + 8, true);
    if (r2) throw takeObject(r1);
    return QuantResultImpl.__wrap(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function downsample_lanczos3(src, srcW, srcH, dstW, dstH) {
  ensureWasm();
  const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
  try {
    const p0 = passArray8(src), l0 = WASM_VECTOR_LEN;
    wasm.downsample_lanczos3(retptr, p0, l0, srcW, srcH, dstW, dstH);
    const r0 = getDataView().getInt32(retptr, true);
    const r1 = getDataView().getInt32(retptr + 4, true);
    const v = getArrayU8(r0, r1).slice();
    wasm.__wbindgen_export2(r0, r1, 1);
    return v;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

// src/quantizers/imagequant-gif.ts
function getMod() {
  return imagequant_gif_wasm_exports;
}
function quantizeWithBackground(rgba, width, height, background, importanceMap, quality, speed, maxColors) {
  const m = getMod();
  const result = m.quantize_with_background(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width,
    height,
    0,
    quality,
    speed,
    maxColors,
    new Uint8Array(background.buffer, background.byteOffset, background.byteLength),
    importanceMap ?? new Uint8Array(0)
  );
  const out = {
    palette: new Uint8Array(result.palette),
    indexed: new Uint8Array(result.indices),
    paletteCount: result.palette_count,
    transparentIndex: result.transparent_index
  };
  result.free();
  return out;
}
function quantizeSimple(rgba, width, height, quality, speed, maxColors) {
  const m = getMod();
  const result = m.quantize_simple(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width,
    height,
    0,
    quality,
    speed,
    maxColors
  );
  const out = {
    palette: new Uint8Array(result.palette),
    indexed: new Uint8Array(result.indices),
    paletteCount: result.palette_count,
    transparentIndex: result.transparent_index
  };
  result.free();
  return out;
}
function buildSharedPalette(frames, width, height, quality, speed, maxColors) {
  const m = getMod();
  const frameSize = width * height * 4;
  const pooled = new Uint8Array(frameSize * frames.length);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    pooled.set(new Uint8Array(f.buffer, f.byteOffset, f.byteLength), i * frameSize);
  }
  return new Uint8Array(m.build_shared_palette(
    pooled,
    width,
    height,
    frames.length,
    0,
    quality,
    speed,
    maxColors
  ));
}
function remapWithPalette(rgba, width, height, palette, background, dither = 1) {
  const m = getMod();
  const result = m.remap_with_palette(
    new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    width,
    height,
    palette,
    new Uint8Array(background.buffer, background.byteOffset, background.byteLength),
    dither
  );
  const out = {
    palette: new Uint8Array(result.palette),
    indexed: new Uint8Array(result.indices),
    paletteCount: result.palette_count,
    transparentIndex: result.transparent_index
  };
  result.free();
  return out;
}
var FrameEncoderWasm = class {
  constructor(width, height) {
    const m = getMod();
    this.encoder = new m.FrameEncoder(width, height);
  }
  setStaticMask(mask) {
    this.encoder.set_static_mask(mask);
  }
  setImportanceMap(map) {
    this.encoder.set_importance_map(map);
  }
  encodeKeyframe(rgba, quality, speed, maxColors) {
    const r = this.encoder.encode_keyframe(
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      quality,
      speed,
      maxColors
    );
    const out = {
      indexed: new Uint8Array(r.indexed),
      paletteRgb: new Uint8Array(r.palette_rgb),
      paletteRgba: new Uint8Array(r.palette_rgba),
      paletteCount: r.palette_count,
      transparentIndex: r.transparent_index,
      left: r.left,
      top: r.top,
      cropWidth: r.crop_width,
      cropHeight: r.crop_height,
      isEmpty: r.is_empty
    };
    r.free();
    return out;
  }
  encodeFrame(rgba, staleThreshold, frameMotion, isQuality, nextFrame, remapPalette, quality, speed, maxColors, sparseRadius) {
    const r = this.encoder.encode_frame(
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      staleThreshold,
      frameMotion,
      isQuality,
      nextFrame ? new Uint8Array(nextFrame.buffer, nextFrame.byteOffset, nextFrame.byteLength) : new Uint8Array(0),
      remapPalette ?? new Uint8Array(0),
      quality,
      speed,
      maxColors,
      6
      // sparseRadius
    );
    const out = {
      indexed: new Uint8Array(r.indexed),
      paletteRgb: new Uint8Array(r.palette_rgb),
      paletteRgba: new Uint8Array(r.palette_rgba),
      paletteCount: r.palette_count,
      transparentIndex: r.transparent_index,
      left: r.left,
      top: r.top,
      cropWidth: r.crop_width,
      cropHeight: r.crop_height,
      isEmpty: r.is_empty
    };
    r.free();
    return out;
  }
  paletteP95Distance(rgba, paletteRgba) {
    return this.encoder.palette_p95_distance(
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      paletteRgba
    );
  }
  free() {
    this.encoder.free();
  }
};
function downsampleWasm(src, srcW, srcH, dstW, dstH) {
  const m = getMod();
  const result = m.downsample_lanczos3(
    new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
    srcW,
    srcH,
    dstW,
    dstH
  );
  return new Uint8ClampedArray(result.buffer, result.byteOffset, result.byteLength);
}

// src/resize.ts
function sinc(x) {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}
function lanczos3(x) {
  if (x < 0) x = -x;
  if (x >= 3) return 0;
  return sinc(x) * sinc(x / 3);
}
function downsample(src, srcW, srcH, dstW, dstH) {
  if (dstW >= srcW && dstH >= srcH) {
    return new Uint8ClampedArray(src);
  }
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
      if (a > 1e-3) {
        tmp[di] = r / a;
        tmp[di + 1] = g / a;
        tmp[di + 2] = b / a;
        tmp[di + 3] = a / wSum * 255;
      }
    }
  }
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
      if (a > 1e-3) {
        dst[di] = Math.round(Math.max(0, Math.min(255, r / a)));
        dst[di + 1] = Math.round(Math.max(0, Math.min(255, g / a)));
        dst[di + 2] = Math.round(Math.max(0, Math.min(255, b / a)));
        dst[di + 3] = Math.round(Math.max(0, Math.min(255, a / wSum * 255)));
      }
    }
  }
  return dst;
}
function resizeFrames(frames, srcW, srcH, dstW, dstH) {
  const h = dstH ?? Math.floor(srcH * (dstW / srcW));
  const resized = frames.map((f) => ({
    data: downsample(f.data, srcW, srcH, dstW, h),
    delay: f.delay
  }));
  return { width: dstW, height: h, frames: resized };
}

// src/index.ts
async function getQuantizeImagequant() {
  const modPath = "./quantizers/imagequant.js";
  const m = await import(
    /* @vite-ignore */
    modPath
  );
  return m.quantizeImagequant;
}
var VERSION = "0.0.1";
var PRESETS = {
  quality: {
    quantizer: "imagequant",
    quantizerQuality: 98,
    quantizerSpeed: 1,
    maxColors: 256,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 0,
    loop: 0,
    optimize: {
      subframe: true,
      cropTolerance: 5,
      holeTolerance: 0,
      transparencyEqualization: true,
      staleThreshold: 3,
      probeTolerance: 3,
      transeqNeighborThreshold: 6,
      disposalOptimize: true,
      dropThreshold: 0,
      frameDiff: true,
      frameDiffTolerance: 0,
      frameDiffErode: 0,
      frameDiffDistanceMode: "max"
    }
  },
  balanced: {
    quantizer: "imagequant",
    quantizerQuality: 90,
    quantizerSpeed: 4,
    maxColors: 256,
    palette: "crossframe",
    dither: "floyd-steinberg",
    ditherSerpentine: true,
    temporalDither: false,
    temporalWeight: 0,
    lossyLzw: 0,
    loop: 0,
    optimize: {
      subframe: true,
      cropTolerance: 5,
      holeTolerance: 0,
      transparencyEqualization: true,
      staleThreshold: 8,
      probeTolerance: 3,
      transeqNeighborThreshold: 6,
      disposalOptimize: true,
      dropThreshold: 0,
      frameDiff: true,
      frameDiffTolerance: 0,
      frameDiffErode: 0,
      frameDiffDistanceMode: "max"
    }
  }
};
function resolveOptions(options) {
  const base = PRESETS[options.preset ?? "balanced"];
  let userOpt;
  if (options.optimize === false) {
    userOpt = {
      subframe: false,
      cropTolerance: 0,
      holeTolerance: 0,
      transparencyEqualization: false,
      staleThreshold: 3,
      probeTolerance: 3,
      transeqNeighborThreshold: 6,
      disposalOptimize: false,
      dropThreshold: 0,
      frameDiff: false,
      frameDiffTolerance: 0,
      frameDiffErode: 0,
      frameDiffDistanceMode: "max"
    };
  } else if (options.optimize) {
    const o = options.optimize;
    userOpt = {
      subframe: o.subframe ?? false,
      cropTolerance: o.cropTolerance ?? base.optimize.cropTolerance,
      holeTolerance: o.holeTolerance ?? base.optimize.holeTolerance,
      transparencyEqualization: o.transparencyEqualization ?? base.optimize.transparencyEqualization,
      staleThreshold: o.staleThreshold ?? base.optimize.staleThreshold,
      probeTolerance: o.probeTolerance ?? base.optimize.probeTolerance,
      transeqNeighborThreshold: o.transeqNeighborThreshold ?? base.optimize.transeqNeighborThreshold,
      disposalOptimize: o.disposalOptimize ?? base.optimize.disposalOptimize,
      dropThreshold: o.dropThreshold ?? base.optimize.dropThreshold,
      frameDiff: o.frameDiff ?? base.optimize.frameDiff,
      frameDiffTolerance: o.frameDiffTolerance ?? base.optimize.frameDiffTolerance,
      frameDiffErode: o.frameDiffErode ?? base.optimize.frameDiffErode,
      frameDiffDistanceMode: o.frameDiffDistanceMode ?? base.optimize.frameDiffDistanceMode
    };
  } else {
    userOpt = base.optimize;
  }
  const quantizer = options.quantizer ?? base.quantizer;
  return {
    quantizer,
    quantizerQuality: quantizer === "neuquant" ? options.quality ?? base.quantizerQuality : options.imagequantQuality ?? base.quantizerQuality,
    quantizerSpeed: options.imagequantSpeed ?? base.quantizerSpeed,
    maxColors: options.maxColors ?? base.maxColors,
    palette: options.palette ?? base.palette,
    dither: options.dither !== void 0 ? options.dither : base.dither,
    ditherSerpentine: options.ditherSerpentine ?? base.ditherSerpentine,
    temporalDither: options.temporalDither ?? base.temporalDither,
    temporalWeight: options.temporalWeight ?? base.temporalWeight,
    lossyLzw: options.lossyLzw ?? base.lossyLzw,
    loop: options.loop ?? base.loop,
    optimize: userOpt
  };
}
async function encode(options) {
  let { width, height } = options;
  let { frames } = options;
  const t = options.timing;
  let t0;
  if (frames.length === 0) {
    throw new Error("At least one frame is required");
  }
  t0 = performance.now();
  const srcWidth = width;
  if (options.targetWidth && options.targetWidth < width) {
    const dstW = options.targetWidth;
    const dstH = options.targetHeight ?? Math.floor(height * (dstW / width));
    frames = frames.map((f) => ({
      data: downsampleWasm(f.data, width, height, dstW, dstH),
      delay: f.delay ?? (frames[0]?.delay ?? 100)
    }));
    width = dstW;
    height = dstH;
  }
  if (t) t.downscale = Math.round(performance.now() - t0);
  const downscaleRatio = srcWidth / width;
  const opts = resolveOptions(options);
  t0 = performance.now();
  const presetName = options.preset ?? "balanced";
  if (presetName === "balanced" && frames.length >= 3) {
    const numPixels = width * height;
    let subPerceptual = 0, changed = 0, totalChecked = 0;
    const step = Math.max(1, Math.floor(frames.length / 6));
    for (let f = step; f < frames.length; f += step) {
      const a = frames[f].data, b = frames[f - 1].data;
      for (let i = 0; i < numPixels; i++) {
        const si = i * 4;
        const maxDev = Math.max(
          Math.abs(a[si] - b[si]),
          Math.abs(a[si + 1] - b[si + 1]),
          Math.abs(a[si + 2] - b[si + 2])
        );
        if (maxDev >= 1 && maxDev <= 2) subPerceptual++;
        if (maxDev > 5) changed++;
        totalChecked++;
      }
    }
    const hasNoise = totalChecked > 0 && subPerceptual / totalChecked > 0.05;
    const hasMotion = totalChecked > 0 && changed / totalChecked > 0.02;
    if (hasNoise && hasMotion) {
      denoiseFrames(frames, width, height, 3);
    }
  }
  if (t) t.denoise = Math.round(performance.now() - t0);
  const dropThreshold = opts.optimize.dropThreshold;
  if (dropThreshold > 0 && frames.length > 1) {
    const kept = [frames[0]];
    const pixelCount = width * height;
    for (let i = 1; i < frames.length; i++) {
      const prev = kept[kept.length - 1].data;
      const curr = frames[i].data;
      let sumSq = 0;
      let sumTotal = 0;
      for (let p = 0; p < pixelCount; p++) {
        const si = p << 2;
        for (let c = 0; c < 3; c++) {
          const d = curr[si + c] - prev[si + c];
          sumSq += d * d;
          sumTotal++;
        }
      }
      const mse = sumSq / sumTotal;
      const psnr = mse > 0 ? 10 * Math.log10(255 * 255 / mse) : 100;
      const ssimApprox = psnr > 48 ? 1 : psnr > 40 ? 0.999 : psnr > 35 ? 0.995 : psnr > 30 ? 0.99 : 0.98;
      if (ssimApprox > dropThreshold) {
        kept[kept.length - 1] = {
          ...kept[kept.length - 1],
          delay: (kept[kept.length - 1].delay ?? 100) + (frames[i].delay ?? 100)
        };
      } else {
        kept.push(frames[i]);
      }
    }
    frames = kept;
  }
  if (opts.optimize.subframe && frames.length > 1) {
    const { gifFrames, probe } = await encodeSubframePipeline(frames, width, height, opts, downscaleRatio, presetName, t, options);
    const lzwComplexity = probe.motionLevel * probe.colorComplexity;
    const adaptiveLzw = options.lossyLzw !== void 0 ? opts.lossyLzw : Math.min(5, Math.max(opts.lossyLzw, Math.round(opts.lossyLzw + lzwComplexity / 3e3)));
    t0 = performance.now();
    const result = writeGif(gifFrames, {
      width,
      height,
      loop: opts.loop,
      lzwEncoder: buildLzwEncoder(adaptiveLzw, gifFrames)
    });
    if (t) t.write = Math.round(performance.now() - t0);
    return result;
  }
  return encodeLegacyPipeline(frames, width, height, opts);
}
function rgbaToRgbPalette(rgba, count) {
  const rgb = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}
async function encodeSubframePipeline(frames, width, height, opts, downscaleRatio = 1, presetName = "balanced", t, rawOptions) {
  const numPixels = width * height;
  const gifFrames = new Array(frames.length);
  const canvasRgba = new Uint8ClampedArray(numPixels * 4);
  let t0;
  t0 = performance.now();
  const probe = probeFrames(
    frames.map((f) => f.data),
    width,
    height,
    opts.optimize.probeTolerance
  );
  if (t) t.probe = Math.round(performance.now() - t0);
  let useGifQuant = false;
  let frameEncoder = null;
  if (opts.quantizer === "imagequant") {
    try {
      quantizeSimple(
        new Uint8ClampedArray(4),
        1,
        1,
        80,
        4,
        4
      );
      useGifQuant = true;
      try {
        frameEncoder = new FrameEncoderWasm(width, height);
      } catch {
      }
    } catch {
    }
  }
  t0 = performance.now();
  const isQuality = presetName === "quality";
  let sharedPalette = null;
  let adaptiveMaxColors = opts.maxColors;
  if (adaptiveMaxColors >= 256 && !isQuality) {
    const gdxc = probe.gradientDensity * probe.colorComplexity;
    if (probe.colorComplexity >= 1e3) {
      if (gdxc > 14e3) adaptiveMaxColors = 256;
      else if (gdxc > 9e3) adaptiveMaxColors = 192;
      else adaptiveMaxColors = 160;
    }
  }
  if (isQuality && probe.colorComplexity >= 3e4) {
    adaptiveMaxColors = Math.min(adaptiveMaxColors, 224);
  }
  if (useGifQuant && opts.palette !== "local" && (downscaleRatio > 1 || opts.palette === "global")) {
    const step = Math.max(1, Math.floor(frames.length / 10));
    const sampled = [];
    for (let f = 0; f < frames.length; f += step) sampled.push(frames[f].data);
    sharedPalette = buildSharedPalette(
      sampled,
      width,
      height,
      opts.quantizerQuality,
      opts.quantizerSpeed,
      Math.max(2, adaptiveMaxColors - 1)
    );
  }
  const importanceMap = new Uint8Array(numPixels);
  for (let j = 0; j < numPixels; j++) {
    importanceMap[j] = probe.staticMask[j] ? 0 : 255;
  }
  if (frameEncoder) {
    frameEncoder.setStaticMask(probe.staticMask);
    frameEncoder.setImportanceMap(importanceMap);
  }
  const useGlobalPalette = !useGifQuant && (opts.palette === "global" || probe.colorComplexity < 1e3 && opts.palette !== "local");
  let globalPalette = null;
  if (useGlobalPalette && opts.quantizer === "imagequant") {
    try {
      const step = Math.max(1, Math.floor(frames.length / 10));
      const parts = [];
      for (let i = 0; i < frames.length; i += step) parts.push(frames[i].data);
      const poolSize = parts.reduce((s, p) => s + p.length, 0);
      const pooled = new Uint8ClampedArray(poolSize);
      let off = 0;
      for (const p of parts) {
        pooled.set(p, off);
        off += p.length;
      }
      const poolResult = await (await getQuantizeImagequant())(
        pooled,
        width,
        poolSize / 4 / width,
        { quality: opts.quantizerQuality, speed: opts.quantizerSpeed, maxColors: opts.maxColors }
      );
      if (poolResult) {
        globalPalette = trimPalette(poolResult.palette, poolResult.indexed).palette;
      }
    } catch {
    }
  } else if (useGlobalPalette && opts.quantizer === "neuquant") {
    globalPalette = neuquant(frames[0].data, opts.quantizerQuality);
  }
  let neuquantPalettes = null;
  if (opts.quantizer === "neuquant" && !globalPalette && !useGifQuant) {
    neuquantPalettes = generatePalettes(frames, opts.palette, opts.quantizerQuality);
  }
  const complexity = probe.motionLevel * probe.colorComplexity;
  const motionAdjust = probe.motionLevel > 0.2 ? -Math.round(Math.min(3, (probe.motionLevel - 0.2) * 5)) : 0;
  let autoThreshold;
  if (isQuality) {
    const motionFloor = probe.motionLevel > 0.01 ? 5 : 4;
    autoThreshold = Math.min(10, Math.max(
      2,
      Math.round(4 + 6 * Math.min(1, complexity / 5e3)) + motionAdjust
    ));
  } else {
    autoThreshold = Math.min(8, Math.max(
      2,
      Math.round(4 + 4 * Math.min(1, complexity / 8e3)) + motionAdjust
    ));
  }
  const userStale = rawOptions?.optimize && typeof rawOptions.optimize === "object" && "staleThreshold" in rawOptions.optimize;
  const staleThreshold = userStale ? opts.optimize.staleThreshold : autoThreshold;
  if (t) t._staleThreshold = staleThreshold;
  if (t) t.palette = Math.round(performance.now() - t0);
  const sceneChangeSet = new Set(probe.sceneChanges);
  const MAX_FRAMES_PER_PALETTE = 10;
  const PALETTE_FITNESS_THRESHOLD = 8;
  function paletteP95Distance(rgba, pal) {
    const palCount = pal.length / 4;
    const sampleStep = Math.max(1, Math.floor(numPixels / 2e3));
    const dists = [];
    for (let j = 0; j < numPixels; j += sampleStep) {
      const si = j * 4;
      const sr = rgba[si], sg = rgba[si + 1], sb = rgba[si + 2];
      let bestDist = 765;
      for (let p = 0; p < palCount; p++) {
        const pi = p * 4;
        const d = Math.abs(sr - pal[pi]) + Math.abs(sg - pal[pi + 1]) + Math.abs(sb - pal[pi + 2]);
        if (d < bestDist) bestDist = d;
      }
      dists.push(bestDist);
    }
    dists.sort((a, b) => a - b);
    return dists[Math.floor(dists.length * 0.95)] ?? 0;
  }
  let activePaletteRgba = null;
  let framesSincePalette = 0;
  let tTransparency = 0, tQuantize = 0, tSubframe = 0;
  t0 = performance.now();
  for (let i = 0; i < frames.length; i++) {
    const delay = Math.round((frames[i].delay ?? 100) / 10);
    const isKeyframe = i === 0 || sceneChangeSet.has(i);
    if (frameEncoder) {
      if (isKeyframe) {
        const fr = frameEncoder.encodeKeyframe(
          frames[i].data,
          opts.quantizerQuality,
          opts.quantizerSpeed,
          adaptiveMaxColors
        );
        activePaletteRgba = buildSharedPalette(
          [frames[i].data],
          width,
          height,
          opts.quantizerQuality,
          opts.quantizerSpeed,
          Math.max(2, adaptiveMaxColors - 1)
        );
        framesSincePalette = 0;
        gifFrames[i] = {
          indexedPixels: fr.indexed,
          palette: fr.paletteRgb,
          width: fr.cropWidth,
          height: fr.cropHeight,
          left: fr.left,
          top: fr.top,
          transparentIndex: fr.transparentIndex >= 0 ? fr.transparentIndex : void 0,
          delay,
          disposal: 0
        };
      } else {
        let useRemapU = false;
        if (activePaletteRgba && framesSincePalette < MAX_FRAMES_PER_PALETTE) {
          const p95 = frameEncoder.paletteP95Distance(frames[i].data, activePaletteRgba);
          if (p95 <= PALETTE_FITNESS_THRESHOLD) useRemapU = true;
        }
        const fm = probe.perFrameMotion[i] ?? probe.motionLevel;
        const nextSrc = i < frames.length - 1 ? frames[i + 1].data : null;
        const remapPal = sharedPalette ?? (useRemapU && activePaletteRgba ? activePaletteRgba : null);
        const fr = frameEncoder.encodeFrame(
          frames[i].data,
          staleThreshold,
          fm,
          isQuality,
          nextSrc,
          remapPal,
          opts.quantizerQuality,
          opts.quantizerSpeed,
          adaptiveMaxColors,
          6
        );
        if (!sharedPalette && !useRemapU) {
          activePaletteRgba = buildSharedPalette(
            [frames[i].data],
            width,
            height,
            opts.quantizerQuality,
            opts.quantizerSpeed,
            Math.max(2, adaptiveMaxColors - 1)
          );
          framesSincePalette = 0;
        } else if (useRemapU) {
          framesSincePalette++;
        }
        if (fr.isEmpty) {
          gifFrames[i] = {
            indexedPixels: new Uint8Array([0]),
            palette: gifFrames[i - 1].palette,
            width: 1,
            height: 1,
            left: 0,
            top: 0,
            delay,
            disposal: 0,
            transparentIndex: 0
          };
        } else {
          gifFrames[i] = {
            indexedPixels: fr.indexed,
            palette: fr.paletteRgb,
            width: fr.cropWidth,
            height: fr.cropHeight,
            left: fr.left,
            top: fr.top,
            transparentIndex: fr.transparentIndex >= 0 ? fr.transparentIndex : void 0,
            delay,
            disposal: 0
          };
        }
      }
      continue;
    }
    let useRemap = false;
    if (!isKeyframe && useGifQuant && activePaletteRgba && framesSincePalette < MAX_FRAMES_PER_PALETTE) {
      const p95 = paletteP95Distance(frames[i].data, activePaletteRgba);
      if (p95 <= PALETTE_FITNESS_THRESHOLD) useRemap = true;
    }
    if (isKeyframe) {
      let indexed2, palette2;
      if (useGifQuant) {
        const r = quantizeSimple(
          frames[i].data,
          width,
          height,
          opts.quantizerQuality,
          opts.quantizerSpeed,
          adaptiveMaxColors
        );
        palette2 = rgbaToRgbPalette(r.palette, r.paletteCount);
        indexed2 = r.indexed;
        activePaletteRgba = buildSharedPalette(
          [frames[i].data],
          width,
          height,
          opts.quantizerQuality,
          opts.quantizerSpeed,
          Math.max(2, adaptiveMaxColors - 1)
        );
        framesSincePalette = 0;
      } else if (globalPalette) {
        palette2 = globalPalette;
        indexed2 = opts.dither === "floyd-steinberg" ? floydSteinberg(frames[i].data, width, height, palette2, opts.ditherSerpentine) : mapNearest(frames[i].data, palette2);
      } else {
        ({ indexed: indexed2, palette: palette2 } = await quantizeFrame(
          frames[i].data,
          width,
          height,
          opts,
          neuquantPalettes?.[i]
        ));
      }
      const trimmed = trimPalette(palette2, indexed2);
      indexed2 = trimmed.indexed;
      palette2 = trimmed.palette;
      gifFrames[i] = {
        indexedPixels: indexed2,
        palette: palette2,
        width,
        height,
        delay,
        disposal: 0
      };
      decodeFrameToCanvas(canvasRgba, indexed2, palette2, width, height);
      continue;
    }
    const curr = frames[i].data;
    if (useGifQuant) {
      let ts = performance.now();
      const inputRgba = new Uint8ClampedArray(curr);
      for (let j = 0; j < numPixels; j++) {
        if (probe.staticMask[j]) {
          inputRgba[j * 4 + 3] = 0;
        }
      }
      const fm = probe.perFrameMotion[i] ?? probe.motionLevel;
      const frameThreshold = !isQuality && fm < 0.02 ? Math.min(10, staleThreshold + 1) : staleThreshold;
      const texMap = new Uint8Array(numPixels);
      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          let tmin = 765, tmax = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = ty + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = tx + dx;
              if (nx < 0 || nx >= width) continue;
              const ti = (ny * width + nx) * 4;
              const lum = inputRgba[ti] + inputRgba[ti + 1] + inputRgba[ti + 2];
              if (lum < tmin) tmin = lum;
              if (lum > tmax) tmax = lum;
            }
          }
          texMap[ty * width + tx] = Math.min(255, tmax - tmin);
        }
      }
      const nextSrc = i < frames.length - 1 ? frames[i + 1].data : null;
      for (let j = 0; j < numPixels; j++) {
        if (inputRgba[j * 4 + 3] === 0) continue;
        const si = j * 4;
        const d = Math.max(
          Math.abs(inputRgba[si] - canvasRgba[si]),
          Math.abs(inputRgba[si + 1] - canvasRgba[si + 1]),
          Math.abs(inputRgba[si + 2] - canvasRgba[si + 2])
        );
        const tex = texMap[j];
        const texFactor = 0.6 + 0.4 * Math.min(1, tex / 40);
        const effectiveThreshold = frameThreshold * texFactor;
        if (d <= effectiveThreshold) {
          let keepForward = false;
          if (nextSrc && tex < 40 && d > 1) {
            const fwdDiff = Math.max(
              Math.abs(nextSrc[si] - canvasRgba[si]),
              Math.abs(nextSrc[si + 1] - canvasRgba[si + 1]),
              Math.abs(nextSrc[si + 2] - canvasRgba[si + 2])
            );
            if (fwdDiff > 4) {
              const dr = (inputRgba[si] - canvasRgba[si]) * (nextSrc[si] - canvasRgba[si]);
              const dg = (inputRgba[si + 1] - canvasRgba[si + 1]) * (nextSrc[si + 1] - canvasRgba[si + 1]);
              const db = (inputRgba[si + 2] - canvasRgba[si + 2]) * (nextSrc[si + 2] - canvasRgba[si + 2]);
              if (dr + dg + db > 0) keepForward = true;
            }
          }
          if (!keepForward) {
            inputRgba[si + 3] = 0;
          }
        }
      }
      tTransparency += performance.now() - ts;
      ts = performance.now();
      let r;
      if (sharedPalette) {
        r = remapWithPalette(inputRgba, width, height, sharedPalette, canvasRgba);
      } else if (useRemap && activePaletteRgba) {
        r = remapWithPalette(inputRgba, width, height, activePaletteRgba, canvasRgba);
        framesSincePalette++;
      } else {
        r = quantizeWithBackground(
          inputRgba,
          width,
          height,
          canvasRgba,
          importanceMap,
          opts.quantizerQuality,
          opts.quantizerSpeed,
          adaptiveMaxColors
        );
        activePaletteRgba = buildSharedPalette(
          [frames[i].data],
          width,
          height,
          opts.quantizerQuality,
          opts.quantizerSpeed,
          Math.max(2, adaptiveMaxColors - 1)
        );
        framesSincePalette = 0;
      }
      tQuantize += performance.now() - ts;
      ts = performance.now();
      const tIdx = r.transparentIndex;
      const rgbPal = rgbaToRgbPalette(r.palette, r.paletteCount);
      let minX = width, maxX = -1, minY = height, maxY = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (r.indexed[y * width + x] !== tIdx) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const suppressed = [];
      if (maxX >= 0) {
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const marginX = Math.max(4, Math.round(bw * 0.4));
        const marginY = Math.max(4, Math.round(bh * 0.4));
        const sparseThreshold = staleThreshold + 2;
        const sparseRadius = 6;
        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            const inEdge = x - minX < marginX || maxX - x < marginX || y - minY < marginY || maxY - y < marginY;
            if (!inEdge) continue;
            const idx = y * width + x;
            if (r.indexed[idx] === tIdx) continue;
            const si = idx * 4;
            const d = Math.max(
              Math.abs(curr[si] - canvasRgba[si]),
              Math.abs(curr[si + 1] - canvasRgba[si + 1]),
              Math.abs(curr[si + 2] - canvasRgba[si + 2])
            );
            if (d > sparseThreshold) continue;
            let hasNeighbor = false;
            const rowStart = y * width;
            const xLo = Math.max(minX, x - sparseRadius);
            const xHi = Math.min(maxX, x + sparseRadius);
            for (let nx = xLo; nx <= xHi; nx++) {
              if (nx === x) continue;
              if (r.indexed[rowStart + nx] !== tIdx) {
                const nsi = (rowStart + nx) * 4;
                const nd = Math.max(
                  Math.abs(curr[nsi] - canvasRgba[nsi]),
                  Math.abs(curr[nsi + 1] - canvasRgba[nsi + 1]),
                  Math.abs(curr[nsi + 2] - canvasRgba[nsi + 2])
                );
                if (nd > sparseThreshold) {
                  hasNeighbor = true;
                  break;
                }
              }
            }
            if (!hasNeighbor) {
              r.indexed[idx] = tIdx;
              suppressed.push(idx);
            }
          }
        }
        minX = width;
        maxX = -1;
        minY = height;
        maxY = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (r.indexed[y * width + x] !== tIdx) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
      }
      if (maxX < 0) {
        gifFrames[i] = {
          indexedPixels: new Uint8Array([0]),
          palette: gifFrames[i - 1].palette,
          width: 1,
          height: 1,
          left: 0,
          top: 0,
          delay,
          disposal: 0,
          transparentIndex: 0
        };
      } else {
        const cw2 = maxX - minX + 1;
        const ch2 = maxY - minY + 1;
        const cropped = new Uint8Array(cw2 * ch2);
        for (let y = 0; y < ch2; y++) {
          const srcOff = (minY + y) * width + minX;
          cropped.set(r.indexed.subarray(srcOff, srcOff + cw2), y * cw2);
        }
        let framePal2 = rgbPal;
        let framePx2 = cropped;
        let frameTIdx2 = tIdx;
        if (tIdx >= 0) {
          const trimmed = trimPalette(rgbPal, cropped, tIdx);
          framePal2 = trimmed.palette;
          framePx2 = trimmed.indexed;
          frameTIdx2 = trimmed.transparentIndex ?? -1;
        }
        gifFrames[i] = {
          indexedPixels: framePx2,
          palette: framePal2,
          width: cw2,
          height: ch2,
          left: minX,
          top: minY,
          transparentIndex: frameTIdx2 >= 0 ? frameTIdx2 : void 0,
          delay,
          disposal: 0
        };
      }
      for (let j = 0; j < numPixels; j++) {
        if (r.indexed[j] !== tIdx) {
          const pi = r.indexed[j] * 4;
          const ci = j * 4;
          canvasRgba[ci] = r.palette[pi];
          canvasRgba[ci + 1] = r.palette[pi + 1];
          canvasRgba[ci + 2] = r.palette[pi + 2];
          canvasRgba[ci + 3] = 255;
        }
      }
      tSubframe += performance.now() - ts;
      continue;
    }
    const prev = frames[i - 1].data;
    const bbox = findChangedBbox(
      curr,
      prev,
      canvasRgba,
      probe.staticMask,
      width,
      height,
      staleThreshold
    );
    if (!bbox) {
      gifFrames[i] = {
        indexedPixels: new Uint8Array([0]),
        palette: gifFrames[i - 1].palette,
        width: 1,
        height: 1,
        left: 0,
        top: 0,
        delay,
        disposal: 0,
        transparentIndex: 0
      };
      continue;
    }
    const cw = bbox.maxX - bbox.minX + 1;
    const ch = bbox.maxY - bbox.minY + 1;
    let indexed, palette;
    if (globalPalette) {
      palette = globalPalette;
      const fullIndexed = opts.dither === "floyd-steinberg" ? floydSteinberg(curr, width, height, palette, opts.ditherSerpentine) : mapNearest(curr, palette);
      indexed = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        const srcOff = (bbox.minY + y) * width + bbox.minX;
        indexed.set(fullIndexed.subarray(srcOff, srcOff + cw), y * cw);
      }
    } else {
      const cropped = cropRgba(curr, width, bbox.minX, bbox.minY, cw, ch);
      if (opts.quantizer === "imagequant") {
        const iqResult = await (await getQuantizeImagequant())(cropped, cw, ch, {
          quality: opts.quantizerQuality,
          speed: opts.quantizerSpeed,
          maxColors: opts.maxColors
        });
        if (iqResult) {
          palette = iqResult.palette;
          indexed = opts.dither === false ? mapNearest(cropped, palette) : iqResult.indexed;
        } else {
          palette = neuquant(cropped, 1);
          indexed = opts.dither === "floyd-steinberg" ? floydSteinberg(cropped, cw, ch, palette, opts.ditherSerpentine) : mapNearest(cropped, palette);
        }
      } else {
        palette = neuquantPalettes?.[i] ?? neuquant(cropped, opts.quantizerQuality);
        indexed = opts.dither === "floyd-steinberg" ? floydSteinberg(cropped, cw, ch, palette, opts.ditherSerpentine) : mapNearest(cropped, palette);
      }
    }
    const sub = buildSubframe(
      indexed,
      palette,
      curr,
      canvasRgba,
      probe.staticMask,
      bbox.minX,
      bbox.minY,
      cw,
      ch,
      width,
      staleThreshold
    );
    let framePal = palette;
    let framePx = sub.indexedPixels;
    let frameTIdx = sub.transparentIndex;
    if (sub.transparentIndex >= 0) {
      const trimmed = trimPalette(palette, sub.indexedPixels, sub.transparentIndex);
      framePal = trimmed.palette;
      framePx = trimmed.indexed;
      frameTIdx = trimmed.transparentIndex ?? -1;
    }
    gifFrames[i] = {
      indexedPixels: framePx,
      palette: framePal,
      width: sub.width,
      height: sub.height,
      left: sub.left,
      top: sub.top,
      transparentIndex: frameTIdx >= 0 ? frameTIdx : void 0,
      delay,
      disposal: 0
    };
    compositeOntoCanvas(canvasRgba, sub, palette, width);
  }
  if (frameEncoder) {
    if (t) t.quantize = Math.round(performance.now() - t0);
    frameEncoder.free();
  } else if (t) {
    t.transparency = Math.round(tTransparency);
    t.quantize = Math.round(tQuantize);
    t.subframe = Math.round(tSubframe);
  }
  return { gifFrames, probe };
}
async function quantizeFrame(rgba, w, h, opts, neuquantPalette) {
  if (opts.quantizer === "imagequant") {
    try {
      const result = await (await getQuantizeImagequant())(rgba, w, h, {
        quality: opts.quantizerQuality,
        speed: opts.quantizerSpeed,
        maxColors: opts.maxColors
      });
      if (result) {
        const indexed = opts.dither === false ? mapNearest(rgba, result.palette) : result.indexed;
        return { indexed, palette: result.palette };
      }
    } catch {
    }
    const pal2 = neuquant(rgba, 1);
    const idx2 = opts.dither === "floyd-steinberg" ? floydSteinberg(rgba, w, h, pal2, opts.ditherSerpentine) : mapNearest(rgba, pal2);
    return { indexed: idx2, palette: pal2 };
  }
  const pal = neuquantPalette ?? neuquant(rgba, opts.quantizerQuality);
  const idx = opts.dither === "floyd-steinberg" ? floydSteinberg(rgba, w, h, pal, opts.ditherSerpentine) : mapNearest(rgba, pal);
  return { indexed: idx, palette: pal };
}
async function encodeLegacyPipeline(frames, width, height, opts) {
  const indexed = new Array(frames.length);
  if (opts.quantizer === "imagequant") {
    for (let i = 0; i < frames.length; i++) {
      const result = await (await getQuantizeImagequant())(
        frames[i].data,
        width,
        height,
        { quality: opts.quantizerQuality, speed: opts.quantizerSpeed, maxColors: opts.maxColors }
      );
      let pixels;
      let palette;
      if (result) {
        pixels = result.indexed;
        palette = result.palette;
      } else {
        palette = neuquant(frames[i].data, 1);
        pixels = floydSteinberg(frames[i].data, width, height, palette, opts.ditherSerpentine);
      }
      indexed[i] = {
        indexedPixels: pixels,
        palette,
        delay: Math.round((frames[i].delay ?? 100) / 10)
      };
    }
  } else {
    const palettes = generatePalettes(frames, opts.palette, opts.quantizerQuality);
    if (opts.temporalDither && opts.dither === "floyd-steinberg" && frames.length > 1) {
      let temporalState = null;
      for (let i = 0; i < frames.length; i++) {
        const prevRgba = i > 0 ? frames[i - 1].data : null;
        const { indexed: pixels, nextState } = ditherFrameTemporal(
          frames[i].data,
          width,
          height,
          palettes[i],
          temporalState,
          prevRgba,
          { spatialWeight: 1, temporalWeight: opts.temporalWeight, serpentine: opts.ditherSerpentine }
        );
        indexed[i] = { indexedPixels: pixels, palette: palettes[i], delay: Math.round((frames[i].delay ?? 100) / 10) };
        temporalState = nextState;
      }
    } else {
      for (let i = 0; i < frames.length; i++) {
        const pixels = opts.dither === "floyd-steinberg" ? floydSteinberg(frames[i].data, width, height, palettes[i], opts.ditherSerpentine) : mapNearest(frames[i].data, palettes[i]);
        indexed[i] = { indexedPixels: pixels, palette: palettes[i], delay: Math.round((frames[i].delay ?? 100) / 10) };
      }
    }
  }
  const useOptimize = opts.optimize.frameDiff && frames.length > 1;
  if (!useOptimize) {
    const gifFrames2 = indexed.map((f) => ({
      indexedPixels: f.indexedPixels,
      palette: f.palette,
      width,
      height,
      delay: f.delay
    }));
    return writeGif(gifFrames2, {
      width,
      height,
      loop: opts.loop,
      lzwEncoder: buildLzwEncoder(opts.lossyLzw, gifFrames2)
    });
  }
  const pixelCount = width * height;
  const gifFrames = new Array(frames.length);
  if (opts.quantizer === "imagequant") {
    for (let i = 0; i < indexed.length; i++) {
      const f = indexed[i];
      if (i === 0) {
        gifFrames[0] = {
          indexedPixels: f.indexedPixels,
          palette: f.palette,
          width,
          height,
          delay: f.delay,
          disposal: 0
        };
      } else {
        const result = punchTransparentHoles(
          f.indexedPixels,
          f.palette,
          frames[i].data,
          frames[i - 1].data,
          width,
          height,
          opts.optimize.frameDiffTolerance,
          opts.optimize.frameDiffErode,
          opts.optimize.frameDiffDistanceMode
        );
        gifFrames[i] = {
          indexedPixels: result.indexedPixels,
          palette: f.palette,
          width: result.width,
          height: result.height,
          left: result.left,
          top: result.top,
          transparentIndex: result.transparentIndex,
          delay: f.delay,
          disposal: 0
        };
      }
    }
  } else {
    const disposals = opts.optimize.disposalOptimize ? optimizeDisposals(frames, width, height, opts.optimize.frameDiffTolerance) : new Array(frames.length).fill(0);
    let prevRgba = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < indexed.length; i++) {
      const f = indexed[i];
      if (i === 0) {
        gifFrames[0] = {
          indexedPixels: f.indexedPixels,
          palette: f.palette,
          width,
          height,
          delay: f.delay,
          disposal: disposals[0]
        };
      } else {
        const diff = computeFrameDiff(
          f.indexedPixels,
          frames[i].data,
          prevRgba,
          width,
          height,
          opts.optimize.frameDiffTolerance
        );
        gifFrames[i] = {
          indexedPixels: diff.indexedPixels,
          palette: f.palette,
          width: diff.width,
          height: diff.height,
          left: diff.left,
          top: diff.top,
          transparentIndex: diff.transparentIndex >= 0 ? diff.transparentIndex : void 0,
          delay: f.delay,
          disposal: disposals[i]
        };
      }
      if (disposals[i] === 2) {
        prevRgba = new Uint8Array(pixelCount * 4);
      } else {
        prevRgba = frames[i].data;
      }
    }
  }
  return writeGif(gifFrames, {
    width,
    height,
    loop: opts.loop,
    lzwEncoder: buildLzwEncoder(opts.lossyLzw, gifFrames)
  });
}
function punchTransparentHoles(currentIndexed, palette, currentRgba, prevRgba, w, h, tolerance, erode = 0, distanceMode = "max") {
  const pixelCount = w * h;
  const changed = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const si = i << 2;
    const dr = currentRgba[si] - prevRgba[si];
    const dg = currentRgba[si + 1] - prevRgba[si + 1];
    const db = currentRgba[si + 2] - prevRgba[si + 2];
    const adr = dr < 0 ? -dr : dr;
    const adg = dg < 0 ? -dg : dg;
    const adb = db < 0 ? -db : db;
    const dist = distanceMode === "sum" ? adr + adg + adb : Math.max(adr, adg, adb);
    if (dist > tolerance) changed[i] = 1;
  }
  for (let e = 0; e < erode; e++) {
    const expand = new Uint8Array(pixelCount);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!changed[y * w + x]) continue;
        const y0 = y > 0 ? y - 1 : 0;
        const y1 = y < h - 1 ? y + 1 : h - 1;
        const x0 = x > 0 ? x - 1 : 0;
        const x1 = x < w - 1 ? x + 1 : w - 1;
        for (let dy = y0; dy <= y1; dy++)
          for (let dx = x0; dx <= x1; dx++)
            expand[dy * w + dx] = 1;
      }
    }
    for (let i = 0; i < pixelCount; i++) if (expand[i]) changed[i] = 1;
  }
  const usedByChanged = new Uint8Array(256);
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (changed[i]) {
        usedByChanged[currentIndexed[i]] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { indexedPixels: new Uint8Array([0]), transparentIndex: 0, left: 0, top: 0, width: 1, height: 1 };
  }
  const numColors = palette.length / 3;
  let palBits = 1;
  while (1 << palBits < numColors) palBits++;
  const maxIdx = (1 << palBits) - 1;
  let tIdx = -1;
  for (let i = maxIdx; i >= 0; i--) {
    if (!usedByChanged[i]) {
      tIdx = i;
      break;
    }
  }
  if (tIdx < 0) {
    return { indexedPixels: currentIndexed.slice(), transparentIndex: -1, left: 0, top: 0, width: w, height: h };
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const srcI = (minY + cy) * w + (minX + cx);
      out[cy * cw + cx] = changed[srcI] ? currentIndexed[srcI] : tIdx;
    }
  }
  return { indexedPixels: out, transparentIndex: tIdx, left: minX, top: minY, width: cw, height: ch };
}
function denoiseFrames(frames, width, height, threshold = 5) {
  const numPixels = width * height;
  let prev2 = frames[0].data;
  let prev1 = frames[1].data;
  for (let f = 2; f < frames.length; f++) {
    const curr = frames[f].data;
    const out = new Uint8ClampedArray(curr);
    for (let i = 0; i < numPixels; i++) {
      const si = i * 4;
      let maxDev = 0;
      for (let c = 0; c < 3; c++) {
        const a = curr[si + c], b = prev1[si + c], d = prev2[si + c];
        const dev = Math.max(Math.abs(a - b), Math.abs(a - d), Math.abs(b - d));
        if (dev > maxDev) maxDev = dev;
      }
      if (maxDev > 0 && maxDev <= threshold) {
        for (let c = 0; c < 3; c++) {
          const a = curr[si + c], b = prev1[si + c], d = prev2[si + c];
          out[si + c] = a > b ? b > d ? b : a > d ? d : a : a > d ? a : b > d ? d : b;
        }
      }
    }
    frames[f] = { data: out, delay: frames[f].delay };
    prev2 = prev1;
    prev1 = out;
  }
}
async function encodeParallel(options, concurrency) {
  const { Worker: NodeWorker } = await import("worker_threads");
  const { cpus } = await import("os");
  const { join, dirname } = await import("path");
  const { fileURLToPath } = await import("url");
  const numWorkers = concurrency ?? Math.max(1, cpus().length - 1);
  const workerPath = join(dirname(fileURLToPath(import.meta.url)), "workers", "frame-worker.js");
  let { width, height, frames } = options;
  if (frames.length === 0) throw new Error("At least one frame is required");
  const opts = resolveOptions(options);
  const presetName = options.preset ?? "balanced";
  const srcWidth = width;
  if (options.targetWidth && options.targetWidth < width) {
    const dstW = options.targetWidth;
    const dstH = options.targetHeight ?? Math.floor(height * (dstW / width));
    const workers = [];
    for (let i = 0; i < numWorkers; i++) {
      workers.push(new NodeWorker(workerPath));
    }
    const resized = new Array(frames.length);
    let nextFrame = 0;
    let completed = 0;
    await new Promise((resolve) => {
      function dispatch(worker) {
        if (nextFrame >= frames.length) return;
        const idx = nextFrame++;
        const buf = frames[idx].data.buffer.slice(
          frames[idx].data.byteOffset,
          frames[idx].data.byteOffset + frames[idx].data.byteLength
        );
        worker.once("message", (msg) => {
          resized[idx] = new Uint8ClampedArray(msg.buffer);
          completed++;
          if (completed === frames.length) resolve();
          else dispatch(worker);
        });
        worker.postMessage({
          type: "downsample",
          id: idx,
          frameBuffer: buf,
          srcW: width,
          srcH: height,
          dstW,
          dstH
        }, [buf]);
      }
      for (const w of workers) dispatch(w);
    });
    width = dstW;
    height = dstH;
    frames = resized.map((data, i) => ({ data, delay: frames[i].delay ?? 100 }));
    for (const w of workers) await w.terminate();
  }
  const downscaleRatio = srcWidth / width;
  if (presetName === "balanced" && frames.length >= 3) {
    const numPixels = width * height;
    let subPerceptual = 0, changed = 0, totalChecked = 0;
    const step = Math.max(1, Math.floor(frames.length / 6));
    for (let f = step; f < frames.length; f += step) {
      const a = frames[f].data, b = frames[f - 1].data;
      for (let i = 0; i < numPixels; i++) {
        const si = i * 4;
        const maxDev = Math.max(
          Math.abs(a[si] - b[si]),
          Math.abs(a[si + 1] - b[si + 1]),
          Math.abs(a[si + 2] - b[si + 2])
        );
        if (maxDev >= 1 && maxDev <= 2) subPerceptual++;
        if (maxDev > 5) changed++;
        totalChecked++;
      }
    }
    if (totalChecked > 0 && subPerceptual / totalChecked > 0.05 && changed / totalChecked > 0.02) {
      denoiseFrames(frames, width, height, 3);
    }
  }
  const { gifFrames, probe } = await encodeSubframePipeline(
    frames,
    width,
    height,
    opts,
    downscaleRatio,
    presetName
  );
  const lzwComplexity = probe.motionLevel * probe.colorComplexity;
  const adaptiveLzw = options.lossyLzw !== void 0 ? opts.lossyLzw : Math.min(5, Math.max(opts.lossyLzw, Math.round(opts.lossyLzw + lzwComplexity / 3e3)));
  return writeGif(gifFrames, {
    width,
    height,
    loop: opts.loop,
    lzwEncoder: buildLzwEncoder(adaptiveLzw, gifFrames)
  });
}
function buildLzwEncoder(lossyLzw, gifFrames) {
  if (lossyLzw <= 0) return void 0;
  let frameIdx = 0;
  return (pixels, minCodeSize) => {
    const f = gifFrames[Math.min(frameIdx, gifFrames.length - 1)];
    frameIdx++;
    return lzwEncodeLossy(pixels, f.palette, minCodeSize, lossyLzw, f.transparentIndex ?? -1);
  };
}

// src/browser/sources/file.ts
var FileSource = class {
  constructor(file) {
    this.file = file;
  }
  /** Returns the video file as an ArrayBuffer for transfer to the worker. */
  async getBuffer() {
    return await this.file.arrayBuffer();
  }
};

// src/browser/worker/worker-pool.ts
function log(...args) {
  console.log(`[gifhero ${(/* @__PURE__ */ new Date()).toISOString().slice(11, 23)}]`, ...args);
}
var EncoderWorker = class {
  constructor() {
    this.worker = null;
    this.nextId = 0;
  }
  getWorker() {
    if (this.worker) return this.worker;
    const url = new URL("./browser-worker.js", import.meta.url);
    log("Creating worker from:", url.href);
    this.worker = new Worker(url, { type: "module" });
    this.worker.addEventListener("error", (e) => {
      console.error(`[gifhero ${(/* @__PURE__ */ new Date()).toISOString().slice(11, 23)}] Worker error:`, e.message, e);
    });
    return this.worker;
  }
  async encode(frames, width, height, options) {
    const id = this.nextId++;
    const worker = this.getWorker();
    const frameBuffers = [];
    const delays = [];
    for (const f of frames) {
      const buf = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
      frameBuffers.push(buf);
      delays.push(f.delay ?? 100);
    }
    const transferSize = frameBuffers.reduce((a, b) => a + b.byteLength, 0);
    log(`Transferring ${frameBuffers.length} frames (${(transferSize / 1024 / 1024).toFixed(1)} MB) to worker...`);
    return new Promise((resolve, reject) => {
      const handler = (e) => {
        if (e.data.id !== id) return;
        worker.removeEventListener("message", handler);
        if (e.data.type === "result" && e.data.gif) {
          log(`Received result from worker: ${(e.data.gif.byteLength / 1024).toFixed(0)} KB`);
          resolve(new Uint8Array(e.data.gif));
        } else {
          reject(new Error(e.data.message ?? "Worker encoding failed"));
        }
      };
      worker.addEventListener("message", handler);
      worker.postMessage(
        { type: "encode", id, frameBuffers, delays, width, height, options },
        frameBuffers
      );
      log("Message posted to worker");
    });
  }
  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
};

// src/browser/builder.ts
function log2(...args) {
  console.log(`[gifhero ${(/* @__PURE__ */ new Date()).toISOString().slice(11, 23)}]`, ...args);
}
function warn(...args) {
  console.warn(`[gifhero ${(/* @__PURE__ */ new Date()).toISOString().slice(11, 23)}]`, ...args);
}
var GifHeroBuilder = class {
  constructor(source) {
    this._fps = 10;
    this._preset = "balanced";
    this._loop = 0;
    this._useWorker = true;
    this._abortController = new AbortController();
    this._source = source;
  }
  /** Frames per second for extraction. Default 10. */
  fps(value) {
    this._fps = Math.max(1, Math.min(60, value));
    return this;
  }
  /** Target output width (Lanczos3 downscale). Height auto-calculated. */
  width(value) {
    this._targetWidth = value;
    return this;
  }
  /** Encoding preset. */
  preset(value) {
    this._preset = value;
    return this;
  }
  /** Lossy LZW compression level. 0 = off, 4 = default. */
  lossyLzw(level) {
    this._lossyLzw = level;
    return this;
  }
  /** Maximum palette colors per frame (2–256). */
  maxColors(n) {
    this._maxColors = n;
    return this;
  }
  /** GIF loop count. 0 = infinite (default), -1 = no loop. */
  loop(count) {
    this._loop = count;
    return this;
  }
  /** Maximum recording duration in seconds (for MediaStream sources). */
  duration(seconds) {
    this._duration = seconds;
    return this;
  }
  /** Progress callback. Receives phase ("extracting" | "encoding") and progress (0–1). */
  onProgress(cb) {
    this._onProgress = cb;
    return this;
  }
  /** Force main-thread encoding (no Web Worker). */
  mainThread() {
    this._useWorker = false;
    return this;
  }
  /** Encode and return the GIF as a Uint8Array. */
  async toGif() {
    const signal = this._abortController.signal;
    if (this._source instanceof FileSource) {
      return this._encodeViaVideoWorker(signal);
    }
    if (this._targetWidth && "targetWidth" in this._source) {
      this._source.targetWidth = this._targetWidth;
    }
    if ("delay" in this._source) {
      this._source.delay = Math.round(1e3 / this._fps);
    }
    log2("Extracting frames...");
    const t0 = performance.now();
    const extracted = await this._source.extract(
      (done, total) => {
        this._onProgress?.({
          phase: "extracting",
          progress: total > 0 ? done / total : 0,
          framesExtracted: done,
          totalFrames: total
        });
        if (done % 10 === 0 || done === total) {
          log2(`Extracted ${done}/${total} frames`);
        }
      },
      signal
    );
    signal.throwIfAborted();
    let frames, width, height;
    if ("materialize" in extracted) {
      log2(`Materializing ${extracted.bitmaps.length} ImageBitmaps to RGBA...`);
      const mt0 = performance.now();
      ({ frames, width, height } = extracted.materialize());
      log2(`Materialized in ${((performance.now() - mt0) / 1e3).toFixed(1)}s`);
    } else {
      ({ frames, width, height } = extracted);
    }
    const extractMs = performance.now() - t0;
    const totalPixels = frames.length * width * height;
    log2(`Extraction done: ${frames.length} frames, ${width}\xD7${height}, ${(extractMs / 1e3).toFixed(1)}s`);
    log2(`Total pixel data: ${(totalPixels * 4 / 1024 / 1024).toFixed(1)} MB`);
    this._onProgress?.({ phase: "encoding", progress: 0 });
    const options = {
      width,
      height,
      frames,
      preset: this._preset,
      loop: this._loop,
      ...this._targetWidth && this._targetWidth < width ? { targetWidth: this._targetWidth } : {},
      ...this._lossyLzw !== void 0 ? { lossyLzw: this._lossyLzw } : {},
      ...this._maxColors !== void 0 ? { maxColors: this._maxColors } : {}
    };
    let gif;
    const t1 = performance.now();
    if (this._useWorker) {
      log2("Starting Web Worker encoding...");
      try {
        const worker = new EncoderWorker();
        try {
          gif = await worker.encode(frames, width, height, options);
        } finally {
          worker.terminate();
        }
        log2(`Worker encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t1) / 1e3).toFixed(1)}s`);
      } catch (err) {
        warn("Worker failed, falling back to main thread:", err.message);
        const t2 = performance.now();
        gif = await encode(options);
        log2(`Main thread encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t2) / 1e3).toFixed(1)}s`);
      }
    } else {
      log2("Starting main thread encoding...");
      gif = await encode(options);
      log2(`Main thread encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB, ${((performance.now() - t1) / 1e3).toFixed(1)}s`);
    }
    const totalMs = performance.now() - t0;
    log2(`Total: ${(totalMs / 1e3).toFixed(1)}s (extract ${(extractMs / 1e3).toFixed(1)}s + encode ${((totalMs - extractMs) / 1e3).toFixed(1)}s)`);
    this._onProgress?.({ phase: "encoding", progress: 1 });
    return gif;
  }
  /** Full pipeline via video worker (demux + decode + probe + encode). */
  async _encodeViaVideoWorker(signal) {
    const source = this._source;
    log2("Reading file...");
    const videoBuffer = await source.getBuffer();
    log2(`File read: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
    signal.throwIfAborted();
    const url = new URL("./video-worker.js", import.meta.url);
    log2("Creating video worker from:", url.href);
    const worker = new Worker(url, { type: "module" });
    return new Promise((resolve, reject) => {
      worker.addEventListener("error", (e) => {
        console.error(`[gifhero ${(/* @__PURE__ */ new Date()).toISOString().slice(11, 23)}] Video worker error:`, e.message);
        reject(new Error(e.message));
      });
      worker.addEventListener("message", (e) => {
        if (e.data.type === "progress") {
          this._onProgress?.({
            phase: e.data.phase,
            progress: e.data.progress
          });
        } else if (e.data.type === "result") {
          log2(`Received GIF from video worker: ${(e.data.gif.byteLength / 1024).toFixed(0)} KB`);
          if (e.data.frameCount && typeof self !== "undefined") {
            self.__gifheroLastFrameCount = e.data.frameCount;
          }
          worker.terminate();
          resolve(new Uint8Array(e.data.gif));
        } else if (e.data.type === "error") {
          worker.terminate();
          reject(new Error(e.data.message));
        }
      });
      worker.postMessage(
        {
          type: "encode-video",
          id: 0,
          videoBuffer,
          fps: this._fps,
          targetWidth: this._targetWidth,
          maxDuration: this._duration,
          preset: this._preset,
          lossyLzw: this._lossyLzw,
          maxColors: this._maxColors,
          loop: this._loop
        },
        [videoBuffer]
      );
      log2("Video sent to worker");
    });
  }
  /** Encode and return the GIF as a Blob. */
  async toBlob() {
    const gif = await this.toGif();
    return new Blob([gif], { type: "image/gif" });
  }
  /** Encode and return an object URL for immediate display. */
  async toUrl() {
    const blob = await this.toBlob();
    return URL.createObjectURL(blob);
  }
  /** Start recording from a MediaStream source. Returns a recorder with stop(). */
  record() {
    const signal = this._abortController.signal;
    let resolveStop = null;
    const source = this._source;
    if (typeof source.startRecording !== "function") {
      throw new Error("record() is only available for MediaStream sources. Use toGif() instead.");
    }
    const stopPromise = source.startRecording(
      this._fps,
      this._duration,
      (extracted, total) => {
        this._onProgress?.({
          phase: "extracting",
          progress: total > 0 ? extracted / total : 0,
          framesExtracted: extracted,
          totalFrames: total
        });
      },
      signal
    );
    return {
      stop: async () => {
        this._abortController.abort();
        const { frames, width, height } = await stopPromise;
        this._onProgress?.({ phase: "encoding", progress: 0 });
        const gif = await encode({
          width,
          height,
          frames,
          preset: this._preset,
          loop: this._loop,
          ...this._targetWidth && this._targetWidth < width ? { targetWidth: this._targetWidth } : {},
          ...this._lossyLzw !== void 0 ? { lossyLzw: this._lossyLzw } : {},
          ...this._maxColors !== void 0 ? { maxColors: this._maxColors } : {}
        });
        this._onProgress?.({ phase: "encoding", progress: 1 });
        return gif;
      }
    };
  }
  /** Cancel extraction or encoding in progress. */
  cancel() {
    this._abortController.abort();
  }
};

// src/browser/sources/video.ts
var VideoSource = class {
  constructor(video, options = {}) {
    this.video = video;
    this.options = options;
  }
  set targetWidth(w) {
    this._targetWidth = w;
  }
  async extract(onProgress, signal) {
    const video = this.video;
    if (video.readyState < 1) {
      await new Promise((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("Video failed to load")), { once: true });
      });
    }
    const fps = this.options.fps ?? 10;
    const start = this.options.startTime ?? 0;
    const end = this.options.endTime ?? video.duration;
    if (!isFinite(end) || end <= start) {
      throw new Error(`Invalid video time range: ${start}\u2013${end}. Is the video loaded?`);
    }
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    let width = srcW;
    let height = srcH;
    if (this._targetWidth && this._targetWidth < srcW) {
      const ideal = this._targetWidth * 3;
      if (srcW > ideal * 1.15) {
        width = Math.min(ideal, 1920);
        height = Math.floor(srcH * (width / srcW));
      }
    } else if (srcW > 2560) {
      width = 1920;
      height = Math.floor(srcH * (width / srcW));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const interval = 1 / fps;
    const times = [];
    for (let t = start; t < end; t += interval) times.push(t);
    const delay = Math.round(1e3 / fps);
    const bitmaps = [];
    const delays = [];
    for (let i = 0; i < times.length; i++) {
      signal?.throwIfAborted();
      video.currentTime = times[i];
      await new Promise((resolve) => {
        video.addEventListener("seeked", () => resolve(), { once: true });
      });
      ctx.drawImage(video, 0, 0, width, height);
      const bitmap = await createImageBitmap(canvas);
      bitmaps.push(bitmap);
      delays.push(delay);
      onProgress?.(i + 1, times.length);
    }
    return {
      bitmaps,
      delays,
      width,
      height,
      materialize() {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const cx = c.getContext("2d", { willReadFrequently: true });
        const frames = [];
        for (let i = 0; i < bitmaps.length; i++) {
          cx.drawImage(bitmaps[i], 0, 0);
          frames.push({ data: cx.getImageData(0, 0, width, height).data, delay: delays[i] });
          bitmaps[i].close();
        }
        bitmaps.length = 0;
        return { frames, width, height };
      }
    };
  }
};

// src/browser/sources/canvas.ts
var CanvasSource = class {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
  }
  async extract(onProgress, signal) {
    const canvas = this.canvas;
    const width = canvas.width;
    const height = canvas.height;
    const frameCount = this.options.frameCount ?? 1;
    const fps = this.options.fps ?? 10;
    const interval = 1e3 / fps;
    const delay = Math.round(interval);
    const ctx = canvas instanceof OffscreenCanvas ? canvas.getContext("2d") : canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context from canvas");
    const frames = [];
    if (frameCount === 1) {
      signal?.throwIfAborted();
      const imageData = ctx.getImageData(0, 0, width, height);
      frames.push({ data: imageData.data, delay });
      onProgress?.(1, 1);
    } else {
      for (let i = 0; i < frameCount; i++) {
        signal?.throwIfAborted();
        if (i > 0) {
          await new Promise((resolve) => {
            const start = performance.now();
            const tick = () => {
              if (performance.now() - start >= interval) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        }
        const imageData = ctx.getImageData(0, 0, width, height);
        frames.push({ data: imageData.data, delay });
        onProgress?.(i + 1, frameCount);
      }
    }
    return { frames, width, height };
  }
};

// src/browser/sources/stream.ts
var StreamSource = class {
  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = options;
  }
  set duration(seconds) {
    this._duration = seconds;
  }
  set targetWidth(w) {
    this._targetWidth = w;
  }
  async extract(onProgress, signal) {
    if (!this._duration) {
      throw new Error(
        "MediaStream source requires .duration(seconds) to set a recording limit, or use .record() for manual stop control."
      );
    }
    return this._capture(this._duration, onProgress, signal);
  }
  startRecording(fps, duration, onProgress, signal) {
    this.options.fps = fps;
    const maxDuration = duration ?? Infinity;
    return this._capture(maxDuration, onProgress, signal);
  }
  async _capture(maxDuration, onProgress, signal) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await new Promise((resolve) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    await video.play();
    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    let width = srcW;
    let height = srcH;
    if (this._targetWidth && this._targetWidth < srcW) {
      const ideal = this._targetWidth * 3;
      if (srcW > ideal * 1.15) {
        width = Math.min(ideal, 1920);
        height = Math.floor(srcH * (width / srcW));
      }
    } else if (srcW > 2560) {
      width = 1920;
      height = Math.floor(srcH * (width / srcW));
    }
    const fps = this.options.fps ?? 10;
    const interval = 1e3 / fps;
    const delay = Math.round(interval);
    const totalFrames = isFinite(maxDuration) ? Math.ceil(maxDuration * fps) : 0;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const bitmaps = [];
    const delays = [];
    const startTime = performance.now();
    return new Promise((resolve) => {
      const stop = () => {
        video.pause();
        video.srcObject = null;
        resolve({
          bitmaps,
          delays,
          width,
          height,
          materialize() {
            const c = document.createElement("canvas");
            c.width = width;
            c.height = height;
            const cx = c.getContext("2d", { willReadFrequently: true });
            const frames = [];
            for (let i = 0; i < bitmaps.length; i++) {
              cx.drawImage(bitmaps[i], 0, 0);
              frames.push({ data: cx.getImageData(0, 0, width, height).data, delay: delays[i] });
              bitmaps[i].close();
            }
            bitmaps.length = 0;
            return { frames, width, height };
          }
        });
      };
      const captureFrame = async () => {
        const elapsed = (performance.now() - startTime) / 1e3;
        if (signal?.aborted || elapsed >= maxDuration) {
          stop();
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        const bitmap = await createImageBitmap(canvas);
        bitmaps.push(bitmap);
        delays.push(delay);
        onProgress?.(bitmaps.length, totalFrames || bitmaps.length);
        setTimeout(captureFrame, interval);
      };
      captureFrame();
      this.stream.getTracks().forEach((track) => {
        track.addEventListener("ended", stop, { once: true });
      });
    });
  }
};

// src/browser/sources/frames.ts
var FramesSource = class {
  constructor(rawFrames, width, height, delay = 100) {
    this.rawFrames = rawFrames;
    this.width = width;
    this.height = height;
    this.delay = delay;
  }
  async extract(onProgress, signal) {
    const frames = [];
    const total = this.rawFrames.length;
    for (let i = 0; i < total; i++) {
      signal?.throwIfAborted();
      const raw = this.rawFrames[i];
      const data = raw instanceof Uint8ClampedArray ? raw : raw.data;
      frames.push({ data, delay: this.delay });
      onProgress?.(i + 1, total);
    }
    return { frames, width: this.width, height: this.height };
  }
};

// src/browser/sources/blob.ts
var BlobSource = class {
  constructor(blob, options = {}) {
    this.blob = blob;
    this.options = options;
  }
  set targetWidth(w) {
    this._targetWidth = w;
  }
  async extract(onProgress, signal) {
    const url = URL.createObjectURL(this.blob);
    try {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      await new Promise((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener(
          "error",
          () => reject(new Error("Failed to load video from Blob \u2014 is it a valid video format?")),
          { once: true }
        );
      });
      const source = new VideoSource(video, this.options);
      source.targetWidth = this._targetWidth;
      return await source.extract(onProgress, signal);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
};

// src/browser/index.ts
var gifhero = {
  /**
   * Create a GIF from an HTML video element.
   *
   * Extracts frames by seeking through the video at the configured FPS.
   *
   * @param video - An HTMLVideoElement with a loaded source.
   * @param options - Optional start/end time and FPS.
   */
  fromVideo(video, options) {
    return new GifHeroBuilder(new VideoSource(video, options));
  },
  /**
   * Create a GIF from a Canvas or OffscreenCanvas.
   *
   * Single frame by default. Set `frameCount` to capture an animation.
   *
   * @param canvas - An HTMLCanvasElement or OffscreenCanvas.
   * @param options - Frame count and FPS for multi-frame capture.
   */
  fromCanvas(canvas, options) {
    return new GifHeroBuilder(new CanvasSource(canvas, options));
  },
  /**
   * Create a GIF from a MediaStream (webcam, screen capture).
   *
   * Use `.duration(seconds)` for auto-stop, or `.record()` for manual control.
   *
   * @param stream - A MediaStream from getUserMedia or getDisplayMedia.
   * @param options - FPS setting.
   */
  fromStream(stream, options) {
    return new GifHeroBuilder(new StreamSource(stream, options));
  },
  /**
   * Create a GIF from raw pixel data.
   *
   * Accepts ImageData objects or raw RGBA Uint8ClampedArrays.
   *
   * @param frames - Array of ImageData or Uint8ClampedArray (RGBA).
   * @param width - Frame width in pixels.
   * @param height - Frame height in pixels.
   */
  fromFrames(frames, width, height) {
    return new GifHeroBuilder(new FramesSource(frames, width, height));
  },
  /**
   * Create a GIF from a video Blob or File.
   *
   * Loads the blob into a temporary video element for frame extraction.
   *
   * @param blob - A Blob or File containing video data.
   * @param options - Optional start/end time and FPS.
   */
  fromBlob(blob, options) {
    return new GifHeroBuilder(new BlobSource(blob, options));
  },
  /**
   * Create a GIF from a video file using VideoDecoder (WebCodecs).
   *
   * The entire pipeline (demux, decode, probe, encode) runs in a
   * Web Worker. No main thread blocking, O(1) memory, and 10-50×
   * faster than seek-based extraction.
   *
   * @param file - A video File or Blob (MP4, WebM, MOV).
   */
  fromFile(file) {
    return new GifHeroBuilder(new FileSource(file));
  }
};
export {
  GifHeroBuilder,
  IncrementalProbe,
  VERSION,
  buildSubframe,
  compositeOntoCanvas,
  computeFrameDiff,
  countUsedColors,
  cropRgba,
  decodeFrameToCanvas,
  ditherFrameTemporal,
  downsample,
  encode,
  encodeParallel,
  findChangedBbox,
  floydSteinberg,
  generatePalettes,
  gifhero,
  lzwEncode,
  lzwEncodeLossy,
  mapNearest,
  neuquant,
  optimizeDisposals,
  probeFrames,
  resizeFrames,
  trimPalette,
  writeGif
};
