/**
 * Test config: texture scaling + drift detection (backward and forward).
 *
 * Base: tex-f06-s40 (best size/quality ratio from previous round)
 * Added: backward drift detection and forward-look (B-frame style)
 *
 * The stale loop in the dist operates on `inputRgba` (current source with
 * static pixels already zeroed) and `canvasRgba` (decoded previous frame).
 * We also need access to previous and next SOURCE frames.
 *
 * We inject a `_prevSrc` / `_nextSrc` reference before the stale loop by
 * capturing them from the `frames` array which is in scope.
 */

const STALE_LINE = 'if (d <= frameThreshold) {';

const LOOP_START = 'for (let j = 0; j < numPixels; j++) {\n        if (inputRgba[j * 4 + 3] === 0) continue;\n        const si = j * 4;\n        const d = Math.max(';

// Texture map precomputation (reused from previous config)
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

// Source frame references for drift/forward detection
const FRAME_REFS = `
      const _prevSrc = i >= _driftWindow ? frames[i - _driftWindow].data : null;
      const _nextSrc = i < frames.length - 1 ? frames[i + 1].data : null;
`;

function makePatch({ texFloor=0.6, texScale=40, driftWindow=0, driftThreshold=0, forwardThreshold=0 }) {
  return (src) => {
    let patched = src;

    // Inject drift window constant at the top of the encode function (after sceneChangeSet)
    patched = patched.replace(
      'const sceneChangeSet = new Set(probe.sceneChanges);',
      `const sceneChangeSet = new Set(probe.sceneChanges);\n    const _driftWindow = ${driftWindow};`
    );

    // Inject texture precompute + frame refs before stale loop
    const preamble = TEXTURE_PRECOMPUTE + (driftWindow > 0 || forwardThreshold > 0 ? FRAME_REFS : '');
    patched = patched.replace(LOOP_START, preamble + '\n      ' + LOOP_START);

    // Build the stale condition
    let conditions = [];

    // Texture-scaled threshold
    conditions.push(
      `const _t = _texMap[j];` +
      ` const _tf = ${texFloor} + ${1 - texFloor} * Math.min(1, _t / ${texScale});` +
      ` const _effT = frameThreshold * _tf;`
    );

    let check = 'd <= _effT';

    // Backward drift detection: keep pixel if accumulated drift exceeds threshold
    if (driftWindow > 0 && driftThreshold > 0) {
      conditions.push(
        `let _keepDrift = false;` +
        ` if (_prevSrc) {` +
        `   const _dd = Math.max(Math.abs(inputRgba[si]-_prevSrc[si]), Math.abs(inputRgba[si+1]-_prevSrc[si+1]), Math.abs(inputRgba[si+2]-_prevSrc[si+2]));` +
        `   if (_dd > ${driftThreshold}) _keepDrift = true;` +
        ` }`
      );
      check = `(${check}) && !_keepDrift`;
    }

    // Forward look: keep pixel if next frame will have a big change
    // (pre-encode the transition to reduce next frame's subframe size)
    if (forwardThreshold > 0) {
      conditions.push(
        `let _keepForward = false;` +
        ` if (_nextSrc) {` +
        `   const _fd = Math.max(Math.abs(_nextSrc[si]-canvasRgba[si]), Math.abs(_nextSrc[si+1]-canvasRgba[si+1]), Math.abs(_nextSrc[si+2]-canvasRgba[si+2]));` +
        `   if (_fd > ${forwardThreshold} && d > 1) _keepForward = true;` +
        ` }`
      );
      check = `(${check}) && !_keepForward`;
    }

    const replacement = conditions.join('\n        ') + `\n        if (${check}) {`;
    patched = patched.replace(STALE_LINE, replacement);

    return patched;
  };
}

module.exports = {
  fixtures: ['bbb-clip-02', 'bbb-clip-01', 'bbb-clip-03', 'city-night', 'talking-head', 'fast-action'],
  outputName: 'drift-detect-test',
  workers: 6,
  variants: [
    // Baseline
    { label: 'baseline' },

    // Best from previous round: texture only
    { label: 'tex', patch: makePatch({ texFloor: 0.6, texScale: 40 }) },

    // Texture + backward drift (look 5 frames back, drift threshold = staleThreshold * 1.2 ≈ 6)
    { label: 'tex-drift5-t6', patch: makePatch({ texFloor: 0.6, texScale: 40, driftWindow: 5, driftThreshold: 6 }) },
    { label: 'tex-drift8-t6', patch: makePatch({ texFloor: 0.6, texScale: 40, driftWindow: 8, driftThreshold: 6 }) },
    { label: 'tex-drift8-t8', patch: makePatch({ texFloor: 0.6, texScale: 40, driftWindow: 8, driftThreshold: 8 }) },

    // Texture + forward look (keep pixel if next frame diff > 8)
    { label: 'tex-fwd8', patch: makePatch({ texFloor: 0.6, texScale: 40, forwardThreshold: 8 }) },
    { label: 'tex-fwd6', patch: makePatch({ texFloor: 0.6, texScale: 40, forwardThreshold: 6 }) },

    // Texture + both drift and forward
    { label: 'tex-drift8-t6-fwd8', patch: makePatch({ texFloor: 0.6, texScale: 40, driftWindow: 8, driftThreshold: 6, forwardThreshold: 8 }) },
    { label: 'tex-drift5-t6-fwd6', patch: makePatch({ texFloor: 0.6, texScale: 40, driftWindow: 5, driftThreshold: 6, forwardThreshold: 6 }) },
  ],
};
