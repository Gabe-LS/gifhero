/**
 * Test config: texture-aware + Weber stale threshold tuning.
 *
 * Hypothesis: high-detail bright areas can tolerate higher stale thresholds
 * (saving bytes), while smooth dark areas need lower thresholds (preventing
 * ghosting). Net: same or smaller file size, better perceptual quality.
 *
 * The stale comparison line in the dist is:
 *   if (d <= frameThreshold) {
 *
 * We inject texture variance computation before the stale loop and
 * modify the comparison to scale by texture and brightness.
 */

const STALE_LINE = 'if (d <= frameThreshold) {';

// Inject texture map computation before the stale loop
const LOOP_START = 'for (let j = 0; j < numPixels; j++) {\n        if (inputRgba[j * 4 + 3] === 0) continue;\n        const si = j * 4;\n        const d = Math.max(';

const TEXTURE_PRECOMPUTE = `
      // Pre-compute per-pixel texture (local variance in 3x3 neighborhood)
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

function makeTexturePatch(weberExp, texFloor, texScale) {
  return (src) => {
    // 1. Insert texture precompute before the stale loop
    let patched = src.replace(LOOP_START, TEXTURE_PRECOMPUTE + '\n      ' + LOOP_START);

    // 2. Replace stale comparison with texture+Weber scaled version
    patched = patched.replace(STALE_LINE,
      `const _b = (inputRgba[si] + inputRgba[si+1] + inputRgba[si+2]) / 3;` +
      ` const _t = _texMap[j];` +
      ` const _wf = Math.pow(_b / 255, ${weberExp});` +
      ` const _tf = ${texFloor} + ${1 - texFloor} * Math.min(1, _t / ${texScale});` +
      ` if (d <= frameThreshold * _wf * _tf) {`
    );
    return patched;
  };
}

function makeWeberOnlyPatch(weberExp) {
  return (src) => src.replace(STALE_LINE,
    `const _b = (inputRgba[si] + inputRgba[si+1] + inputRgba[si+2]) / 3;` +
    ` if (d <= frameThreshold * Math.pow(_b / 255, ${weberExp})) {`
  );
}

module.exports = {
  fixtures: ['bbb-clip-02', 'bbb-clip-01', 'bbb-clip-03', 'city-night', 'talking-head', 'fast-action'],
  outputName: 'texture-weber-test',
  workers: 6,
  variants: [
    // Baseline: no modifications
    { label: 'baseline' },

    // Weber only (reference)
    { label: 'w006', patch: makeWeberOnlyPatch(0.06) },

    // Texture only: high-detail areas get higher threshold
    // texFloor=0.6 means smooth areas get 60% of threshold, detailed get 100%
    { label: 'tex-f06-s40', patch: (src) => {
      let p = src.replace(LOOP_START, TEXTURE_PRECOMPUTE + '\n      ' + LOOP_START);
      return p.replace(STALE_LINE,
        `const _t = _texMap[j];` +
        ` const _tf = 0.6 + 0.4 * Math.min(1, _t / 40);` +
        ` if (d <= frameThreshold * _tf) {`);
    }},

    // Combined: Weber 0.06 + texture scaling
    // Smooth dark: threshold * 0.87 * 0.6 = 0.52x (very protective)
    // Detailed bright: threshold * 0.99 * 1.0 = 0.99x (nearly unchanged)
    { label: 'w006-tex-f06-s40', patch: makeTexturePatch(0.06, 0.6, 40) },
    { label: 'w006-tex-f05-s40', patch: makeTexturePatch(0.06, 0.5, 40) },
    { label: 'w006-tex-f07-s40', patch: makeTexturePatch(0.06, 0.7, 40) },

    // Aggressive texture, gentle Weber
    { label: 'w004-tex-f05-s30', patch: makeTexturePatch(0.04, 0.5, 30) },
    { label: 'w004-tex-f06-s30', patch: makeTexturePatch(0.04, 0.6, 30) },
  ],
};
