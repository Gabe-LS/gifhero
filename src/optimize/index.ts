export { computeFrameDiff, computeIndexDiff, countChangedPixelsRgba } from "./frame-diff.js";
export type { FrameDiffResult } from "./frame-diff.js";
export { optimizeDisposals } from "./disposal.js";
export { generatePalettes } from "./palette-strategy.js";
export type { PaletteStrategy } from "./palette-strategy.js";
export { stabilizeStaticPixels } from "./stabilize.js";
export { sortPaletteByLuminance } from "./palette-sort.js";
export { cropRgba, findChangedBbox, buildSubframe, compositeOntoCanvas, decodeFrameToCanvas } from "./subframe.js";
export type { SubframeResult } from "./subframe.js";
