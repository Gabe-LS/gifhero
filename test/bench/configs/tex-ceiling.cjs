/**
 * Size-neutral texture tuning: lower floor (protect smooth) + ceiling >1.0
 * (more aggressive on detailed) to offset. Net pixel budget stays ~same.
 *
 * Formula: threshold × (floor + (ceiling - floor) × min(1, variance / texScale))
 */

const STALE_LINE = 'if (d <= frameThreshold) {';
const LOOP_START = 'for (let j = 0; j < numPixels; j++) {\n        if (inputRgba[j * 4 + 3] === 0) continue;\n        const si = j * 4;\n        const d = Math.max(';

const TEXTURE_PRECOMPUTE = `
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
`;

function makePatch(floor, ceiling, scale) {
  return (src) => {
    let p = src.replace(LOOP_START, TEXTURE_PRECOMPUTE + '\n      ' + LOOP_START);
    return p.replace(STALE_LINE,
      `const _t = _texMap[j];` +
      ` const _tf = ${floor} + ${ceiling - floor} * Math.min(1, _t / ${scale});` +
      ` if (d <= frameThreshold * _tf) {`
    );
  };
}

module.exports = {
  fixtures: ['bbb-clip-02', 'bbb-clip-01', 'bbb-clip-03', 'city-night', 'talking-head', 'fast-action'],
  outputName: 'tex-ceiling',
  workers: 6,
  variants: [
    { label: 'baseline' },

    // Reference: current best (floor=0.6, ceiling=1.0)
    { label: 'f06-c10-s40', patch: makePatch(0.6, 1.0, 40) },

    // Size-neutral: lower floor, raise ceiling to compensate
    { label: 'f05-c11-s40', patch: makePatch(0.5, 1.1, 40) },
    { label: 'f04-c12-s40', patch: makePatch(0.4, 1.2, 40) },
    { label: 'f03-c13-s40', patch: makePatch(0.3, 1.3, 40) },

    // Same idea but tighter texture scale (variance 30 = "fully detailed")
    { label: 'f05-c11-s30', patch: makePatch(0.5, 1.1, 30) },
    { label: 'f04-c12-s30', patch: makePatch(0.4, 1.2, 30) },

    // Wider texture scale (need variance 50 to be "fully detailed")
    { label: 'f05-c11-s50', patch: makePatch(0.5, 1.1, 50) },
    { label: 'f04-c12-s50', patch: makePatch(0.4, 1.2, 50) },
  ],
};
