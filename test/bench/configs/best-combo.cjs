const STALE_LINE = 'if (d <= frameThreshold) {';
const LOOP_START = 'for (let j = 0; j < numPixels; j++) {\n        if (inputRgba[j * 4 + 3] === 0) continue;\n        const si = j * 4;\n        const d = Math.max(';

const PREAMBLE = `
      const _texMap = new Uint8Array(numPixels);
      for (let _y = 0; _y < height; _y++) {
        for (let _x = 0; _x < width; _x++) {
          let _min = 255, _max = 0;
          for (let _dy = -1; _dy <= 1; _dy++) {
            const _ny = _y + _dy;
            if (_ny < 0 || _ny >= height) continue;
            for (let _dx = -1; _dx <= 1; _dx++) {
              const _nx = _x + _dx;
              if (_nx < 0 || _nx >= width) continue;
              const _si = (_ny * width + _nx) * 4;
              const _lum = (inputRgba[_si] + inputRgba[_si+1] + inputRgba[_si+2]);
              if (_lum < _min) _min = _lum;
              if (_lum > _max) _max = _lum;
            }
          }
          _texMap[_y * width + _x] = Math.min(255, _max - _min);
        }
      }
      const _nextSrc = i < frames.length - 1 ? frames[i + 1].data : null;
`;

// f06-c10-s40: the safe texture base with no regressions
const TEX_SAFE = `const _t = _texMap[j]; const _tf = 0.6 + 0.4 * Math.min(1, _t / 40); const _effT = frameThreshold * _tf;`;

function makeCombo(fwd, gate) {
  return (src) => {
    let p = src.replace(LOOP_START, PREAMBLE + '\n      ' + LOOP_START);
    return p.replace(STALE_LINE,
      TEX_SAFE +
      ` let _keepFwd = false;` +
      ` if (_nextSrc && _t < ${gate}) {` +
      `   const _fd = Math.max(Math.abs(_nextSrc[si]-canvasRgba[si]), Math.abs(_nextSrc[si+1]-canvasRgba[si+1]), Math.abs(_nextSrc[si+2]-canvasRgba[si+2]));` +
      `   const _dr = (inputRgba[si]-canvasRgba[si]) * (_nextSrc[si]-canvasRgba[si]);` +
      `   const _dg = (inputRgba[si+1]-canvasRgba[si+1]) * (_nextSrc[si+1]-canvasRgba[si+1]);` +
      `   const _db = (inputRgba[si+2]-canvasRgba[si+2]) * (_nextSrc[si+2]-canvasRgba[si+2]);` +
      `   if ((_dr + _dg + _db) > 0 && _fd > ${fwd} && d > 1) _keepFwd = true;` +
      ` }` +
      ` if (d <= _effT && !_keepFwd) {`
    );
  };
}

function makeTexOnly() {
  return (src) => {
    let p = src.replace(LOOP_START, PREAMBLE + '\n      ' + LOOP_START);
    return p.replace(STALE_LINE, TEX_SAFE + ` if (d <= _effT) {`);
  };
}

module.exports = {
  fixtures: ['bbb-clip-01', 'bbb-clip-02', 'bbb-clip-03', 'bbb-clip-04', 'bbb-clip-05',
    'city-night', 'talking-head', 'fast-action', 'jellyfish', 'sintel',
    'big-buck-bunny', 'screencast', 'skin-tones', 'candle-flame'],
  outputName: 'best-combo',
  workers: 6,
  variants: [
    { label: 'baseline' },
    { label: 'tex-f06', patch: makeTexOnly() },
    { label: 'tex-f06-dfwd4-g40', patch: makeCombo(4, 40) },
  ],
};
