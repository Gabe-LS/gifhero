/**
 * Palette sorting for improved LZW compression.
 *
 * Reorders palette entries by luminance so that smooth gradients
 * map to sequential indices, producing longer LZW dictionary
 * matches with no visual change.
 *
 * @module
 */

/**
 * Sort a flat RGB palette by luminance and remap indexed pixels.
 *
 * @param palette - Flat RGB palette bytes [R,G,B, R,G,B, …]
 * @param indexed - Pixel indices into the palette
 * @param transparentIndex - If set (≥ 0), this index is moved to the
 *   last slot after sorting so that transparency is preserved.
 * @returns Sorted palette, remapped pixels, and updated transparent index
 */
export function sortPaletteByLuminance(
  palette: Uint8Array,
  indexed: Uint8Array,
  transparentIndex?: number,
): { palette: Uint8Array; indexed: Uint8Array; transparentIndex?: number } {
  const numColors = (palette.length / 3) | 0;

  const entries: Array<{ origIndex: number; lum: number }> = [];
  for (let i = 0; i < numColors; i++) {
    const r = palette[i * 3];
    const g = palette[i * 3 + 1];
    const b = palette[i * 3 + 2];
    entries.push({ origIndex: i, lum: 0.299 * r + 0.587 * g + 0.114 * b });
  }

  const hasTransparent = transparentIndex != null && transparentIndex >= 0 && transparentIndex < numColors;

  entries.sort((a, b) => {
    // Transparent entry goes to the end
    if (hasTransparent) {
      if (a.origIndex === transparentIndex) return 1;
      if (b.origIndex === transparentIndex) return -1;
    }
    return a.lum - b.lum;
  });

  // Build old→new remapping table
  const oldToNew = new Uint8Array(256);
  const sortedPalette = new Uint8Array(palette.length);
  for (let newIdx = 0; newIdx < entries.length; newIdx++) {
    const old = entries[newIdx].origIndex;
    oldToNew[old] = newIdx;
    sortedPalette[newIdx * 3] = palette[old * 3];
    sortedPalette[newIdx * 3 + 1] = palette[old * 3 + 1];
    sortedPalette[newIdx * 3 + 2] = palette[old * 3 + 2];
  }

  const remapped = new Uint8Array(indexed.length);
  for (let i = 0; i < indexed.length; i++) {
    remapped[i] = oldToNew[indexed[i]];
  }

  return {
    palette: sortedPalette,
    indexed: remapped,
    transparentIndex: hasTransparent ? oldToNew[transparentIndex!] : transparentIndex,
  };
}
