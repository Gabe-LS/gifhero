/**
 * Full benchmark: tex-f06-dfwd4-g40 vs gifhero-balanced vs gifhero-quality
 * across all fixtures at 480p. Includes encoding time.
 */

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

const TEX_SAFE = `const _t = _texMap[j]; const _tf = 0.6 + 0.4 * Math.min(1, _t / 40); const _effT = frameThreshold * _tf;`;

function makeCandidate() {
  return (src) => {
    let p = src.replace(LOOP_START, PREAMBLE + '\n      ' + LOOP_START);
    return p.replace(STALE_LINE,
      TEX_SAFE +
      ` let _keepFwd = false;` +
      ` if (_nextSrc && _t < 40) {` +
      `   const _fd = Math.max(Math.abs(_nextSrc[si]-canvasRgba[si]), Math.abs(_nextSrc[si+1]-canvasRgba[si+1]), Math.abs(_nextSrc[si+2]-canvasRgba[si+2]));` +
      `   const _dr = (inputRgba[si]-canvasRgba[si]) * (_nextSrc[si]-canvasRgba[si]);` +
      `   const _dg = (inputRgba[si+1]-canvasRgba[si+1]) * (_nextSrc[si+1]-canvasRgba[si+1]);` +
      `   const _db = (inputRgba[si+2]-canvasRgba[si+2]) * (_nextSrc[si+2]-canvasRgba[si+2]);` +
      `   if ((_dr + _dg + _db) > 0 && _fd > 4 && d > 1) _keepFwd = true;` +
      ` }` +
      ` if (d <= _effT && !_keepFwd) {`
    );
  };
}

const { readdirSync, statSync } = require('fs');
const { join } = require('path');
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'generated');

const allFixtures = readdirSync(FIXTURES_DIR)
  .filter(f => {
    try { return statSync(join(FIXTURES_DIR, f)).isDirectory() && readdirSync(join(FIXTURES_DIR, f)).some(x => x.endsWith('.png')); }
    catch { return false; }
  })
  .filter(f => f !== 'gradient' && f !== 'solid-red')
  .sort();

module.exports = {
  fixtures: allFixtures,
  outputName: 'full-bench-candidate',
  workers: 6,
  variants: [
    { label: 'balanced', opts: { preset: 'balanced', palette: undefined } },
    { label: 'quality', opts: { preset: 'quality', palette: undefined } },
    { label: 'candidate', patch: makeCandidate() },
  ],
};
