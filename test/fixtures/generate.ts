/**
 * Generate programmatic test fixtures for gifhero benchmarking.
 * Outputs PNG frame sequences that serve as "ground truth" source material.
 *
 * Run: npx tsx test/fixtures/generate.ts
 */

import { createCanvas } from "canvas";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "generated");

function ensureDir(path: string) {
  mkdirSync(path, { recursive: true });
}

/** Get RGBA Uint8ClampedArray from a canvas */
function getPixels(
  canvas: ReturnType<typeof createCanvas>
): Uint8ClampedArray {
  const ctx = canvas.getContext("2d");
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

function savePNG(
  canvas: ReturnType<typeof createCanvas>,
  path: string
) {
  writeFileSync(path, canvas.toBuffer("image/png"));
}

// ─────────────────────────────────────────────
// 1. Solid color — single frame, simplest case
// ─────────────────────────────────────────────
function generateSolid() {
  const dir = join(FIXTURES_DIR, "solid-red");
  ensureDir(dir);

  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 100, 100);
  savePNG(canvas, join(dir, "0001.png"));

  console.log("✓ solid-red (1 frame, 100×100)");
}

// ─────────────────────────────────────────────
// 2. Two-frame animation — red → blue
// ─────────────────────────────────────────────
function generateTwoFrame() {
  const dir = join(FIXTURES_DIR, "two-frame");
  ensureDir(dir);

  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 100, 100);
  savePNG(canvas, join(dir, "0001.png"));

  ctx.fillStyle = "#0000ff";
  ctx.fillRect(0, 0, 100, 100);
  savePNG(canvas, join(dir, "0002.png"));

  console.log("✓ two-frame (2 frames, 100×100)");
}

// ─────────────────────────────────────────────
// 3. Horizontal rainbow gradient — quantizer stress test
// ─────────────────────────────────────────────
function generateGradient() {
  const dir = join(FIXTURES_DIR, "gradient");
  ensureDir(dir);

  const width = 480;
  const height = 270;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#ff0000");
  gradient.addColorStop(0.17, "#ffff00");
  gradient.addColorStop(0.33, "#00ff00");
  gradient.addColorStop(0.5, "#00ffff");
  gradient.addColorStop(0.67, "#0000ff");
  gradient.addColorStop(0.83, "#ff00ff");
  gradient.addColorStop(1, "#ff0000");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  savePNG(canvas, join(dir, "0001.png"));

  console.log("✓ gradient (1 frame, 480×270, full spectrum)");
}

// ─────────────────────────────────────────────
// 4. Rotating color wheel — 60 frames, temporal stress test
//    Tests dithering consistency across frames
// ─────────────────────────────────────────────
function generateColorWheel() {
  const dir = join(FIXTURES_DIR, "color-wheel");
  ensureDir(dir);

  const width = 480;
  const height = 480;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 10;
  const frames = 60;

  for (let f = 0; f < frames; f++) {
    const rotation = (f / frames) * Math.PI * 2;

    // Black background
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    // Draw color wheel as radial segments
    const segments = 360;
    for (let i = 0; i < segments; i++) {
      const angle = ((i / segments) * Math.PI * 2) + rotation;
      const nextAngle = (((i + 1) / segments) * Math.PI * 2) + rotation;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, angle, nextAngle);
      ctx.closePath();

      const hue = (i / segments) * 360;
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
      ctx.fill();
    }

    // Inner gradient circle (smooth gradient stress)
    const innerGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.4);
    innerGradient.addColorStop(0, "white");
    innerGradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = innerGradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();

    const frameNum = String(f + 1).padStart(4, "0");
    savePNG(canvas, join(dir, `${frameNum}.png`));
  }

  console.log("✓ color-wheel (60 frames, 480×480, rotating hue)");
}

// ─────────────────────────────────────────────
// 5. Text on background — screencast-like content
//    Sharp edges, flat colors, large static regions
// ─────────────────────────────────────────────
function generateScreencast() {
  const dir = join(FIXTURES_DIR, "screencast");
  ensureDir(dir);

  const width = 480;
  const height = 270;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const frames = 60;

  const codeLines = [
    'import { encode } from "gifhero";',
    "",
    "const gif = await encode({",
    "  width: 640,",
    "  height: 480,",
    "  frames: videoFrames,",
    '  preset: "balanced",',
    "});",
    "",
    "// Save the output",
    'saveFile("output.gif", gif);',
  ];

  for (let f = 0; f < frames; f++) {
    // Dark editor background
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, width, height);

    // Line numbers gutter
    ctx.fillStyle = "#252526";
    ctx.fillRect(0, 0, 40, height);

    // Simulate typing: reveal characters progressively
    const totalChars = codeLines.join("\n").length;
    const charsVisible = Math.floor((f / frames) * totalChars * 1.2);

    let charCount = 0;
    ctx.font = "13px monospace";

    for (let line = 0; line < codeLines.length; line++) {
      const y = 20 + line * 18;

      // Line number
      ctx.fillStyle = "#858585";
      ctx.fillText(String(line + 1), 10, y);

      // Code text
      const text = codeLines[line];
      for (let c = 0; c < text.length; c++) {
        if (charCount >= charsVisible) break;

        // Syntax coloring
        const char = text[c];
        if ("{}()[];,".includes(char)) {
          ctx.fillStyle = "#d4d4d4";
        } else if (text.startsWith("import") || text.startsWith("const") || text.startsWith("await")) {
          ctx.fillStyle = "#569cd6";
        } else if (text.includes('"') && c >= text.indexOf('"') && c <= text.lastIndexOf('"')) {
          ctx.fillStyle = "#ce9178";
        } else if (text.startsWith("//")) {
          ctx.fillStyle = "#6a9955";
        } else {
          ctx.fillStyle = "#d4d4d4";
        }

        ctx.fillText(char, 48 + c * 7.8, y);
        charCount++;
      }
      charCount++; // newline
    }

    // Blinking cursor
    if (f % 10 < 5) {
      let cursorLine = 0;
      let cursorCol = 0;
      let count = 0;
      for (let line = 0; line < codeLines.length && count < charsVisible; line++) {
        for (let c = 0; c < codeLines[line].length && count < charsVisible; c++) {
          cursorLine = line;
          cursorCol = c + 1;
          count++;
        }
        count++;
      }
      ctx.fillStyle = "#aeafad";
      ctx.fillRect(48 + cursorCol * 7.8, 8 + cursorLine * 18, 2, 15);
    }

    const frameNum = String(f + 1).padStart(4, "0");
    savePNG(canvas, join(dir, `${frameNum}.png`));
  }

  console.log("✓ screencast (60 frames, 480×270, typing simulation)");
}

// ─────────────────────────────────────────────
// 6. Moving shapes with gradients — general animation test
//    Combines motion, gradients, transparency, flat colors
// ─────────────────────────────────────────────
function generateShapes() {
  const dir = join(FIXTURES_DIR, "shapes");
  ensureDir(dir);

  const width = 480;
  const height = 270;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const frames = 60;

  for (let f = 0; f < frames; f++) {
    const t = f / frames;

    // Sky gradient background
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, `hsl(${200 + t * 30}, 70%, ${60 + t * 10}%)`);
    bg.addColorStop(1, `hsl(${30 + t * 20}, 80%, ${70 + t * 10}%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Moving circle with radial gradient
    const cx = width * 0.3 + Math.sin(t * Math.PI * 2) * 80;
    const cy = height * 0.4 + Math.cos(t * Math.PI * 4) * 30;
    const grad = ctx.createRadialGradient(cx - 10, cy - 10, 5, cx, cy, 50);
    grad.addColorStop(0, "#ff6b6b");
    grad.addColorStop(0.7, "#ee5a24");
    grad.addColorStop(1, "rgba(200,50,50,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.fill();

    // Rotating rectangle
    ctx.save();
    ctx.translate(width * 0.7, height * 0.5);
    ctx.rotate(t * Math.PI * 2);
    ctx.fillStyle = "#2ecc71";
    ctx.fillRect(-30, -30, 60, 60);
    ctx.restore();

    // Bouncing triangle
    const triY = height * 0.7 + Math.abs(Math.sin(t * Math.PI * 3)) * -60;
    ctx.fillStyle = "#3498db";
    ctx.beginPath();
    ctx.moveTo(width * 0.5, triY - 25);
    ctx.lineTo(width * 0.5 - 25, triY + 25);
    ctx.lineTo(width * 0.5 + 25, triY + 25);
    ctx.closePath();
    ctx.fill();

    const frameNum = String(f + 1).padStart(4, "0");
    savePNG(canvas, join(dir, `${frameNum}.png`));
  }

  console.log("✓ shapes (60 frames, 480×270, animated shapes)");
}

// ─────────────────────────────────────────────
// 7. Photo-like content — skin tones and natural colors
//    Simulates a face-like color distribution
// ─────────────────────────────────────────────
function generateSkinTones() {
  const dir = join(FIXTURES_DIR, "skin-tones");
  ensureDir(dir);

  const width = 480;
  const height = 270;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const frames = 60;

  for (let f = 0; f < frames; f++) {
    const t = f / frames;

    // Warm background
    ctx.fillStyle = "#f5e6d3";
    ctx.fillRect(0, 0, width, height);

    // Simulated portrait: overlapping warm circles with subtle movement
    const faces = [
      { x: width * 0.35, y: height * 0.45, r: 60, hue: 25, sat: 60, light: 65 },
      { x: width * 0.65, y: height * 0.45, r: 55, hue: 20, sat: 55, light: 55 },
    ];

    for (const face of faces) {
      const fx = face.x + Math.sin(t * Math.PI * 2) * 3;
      const fy = face.y + Math.cos(t * Math.PI * 2) * 2;

      // Face base
      const faceGrad = ctx.createRadialGradient(
        fx - 5, fy - 10, face.r * 0.1,
        fx, fy, face.r
      );
      faceGrad.addColorStop(0, `hsl(${face.hue}, ${face.sat + 10}%, ${face.light + 5}%)`);
      faceGrad.addColorStop(0.5, `hsl(${face.hue}, ${face.sat}%, ${face.light}%)`);
      faceGrad.addColorStop(0.8, `hsl(${face.hue + 5}, ${face.sat - 10}%, ${face.light - 10}%)`);
      faceGrad.addColorStop(1, `hsl(${face.hue + 10}, ${face.sat - 20}%, ${face.light - 20}%)`);

      ctx.fillStyle = faceGrad;
      ctx.beginPath();
      ctx.ellipse(fx, fy, face.r, face.r * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Subtle blush
      ctx.fillStyle = `hsla(0, 50%, 65%, 0.15)`;
      ctx.beginPath();
      ctx.ellipse(fx - 20, fy + 10, 15, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(fx + 20, fy + 10, 15, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hair-like dark areas
    ctx.fillStyle = "#3d2b1f";
    ctx.beginPath();
    ctx.ellipse(width * 0.35, height * 0.2, 65, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(width * 0.65, height * 0.22, 60, 38, 0, 0, Math.PI * 2);
    ctx.fill();

    const frameNum = String(f + 1).padStart(4, "0");
    savePNG(canvas, join(dir, `${frameNum}.png`));
  }

  console.log("✓ skin-tones (60 frames, 480×270, portrait simulation)");
}

// ─────────────────────────────────────────────
// 8. High contrast pixel art — easy case baseline
// ─────────────────────────────────────────────
function generatePixelArt() {
  const dir = join(FIXTURES_DIR, "pixel-art");
  ensureDir(dir);

  const size = 16; // 16x16 pixel art, scaled up
  const scale = 30; // display at 480x480
  const width = size * scale;
  const height = size * scale;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const frames = 60;

  // Simple sprite colors
  const palette = [
    "#000000", "#1a1c2c", "#5d275d", "#b13e53",
    "#ef7d57", "#ffcd75", "#a7f070", "#38b764",
    "#257179", "#29366f", "#3b5dc9", "#41a6f6",
    "#73eff7", "#f4f4f4", "#94b0c2", "#566c86",
  ];

  // Simple character (heart shape that pulses)
  const heartPixels = [
    "..xxxx..xxxx..",
    ".xxxxxxxx xxxx.",
    "xxxxxxxxxxxxxx",
    "xxxxxxxxxxxxxx",
    "xxxxxxxxxxxxxx",
    ".xxxxxxxxxxxx.",
    "..xxxxxxxxxx..",
    "...xxxxxxxx...",
    "....xxxxxx....",
    ".....xxxx.....",
    "......xx......",
  ];

  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const pulse = 1 + Math.sin(t * Math.PI * 4) * 0.1;

    // Background
    ctx.fillStyle = palette[1];
    ctx.fillRect(0, 0, width, height);

    // Checkerboard floor
    for (let x = 0; x < size; x++) {
      for (let y = 10; y < size; y++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? palette[14] : palette[15];
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    // Draw heart
    const colorIdx = Math.floor(t * palette.length) % palette.length;
    const heartColor = palette[3 + (colorIdx % 4)];
    const offsetX = (size - 14) / 2;
    const offsetY = 0;

    ctx.save();
    ctx.translate(width / 2, height * 0.35);
    ctx.scale(pulse, pulse);
    ctx.translate(-width / 2, -height * 0.35);

    for (let row = 0; row < heartPixels.length; row++) {
      for (let col = 0; col < heartPixels[row].length; col++) {
        if (heartPixels[row][col] === "x") {
          ctx.fillStyle = heartColor;
          ctx.fillRect(
            (col + offsetX) * scale,
            (row + offsetY) * scale,
            scale,
            scale
          );
        }
      }
    }
    ctx.restore();

    const frameNum = String(f + 1).padStart(4, "0");
    savePNG(canvas, join(dir, `${frameNum}.png`));
  }

  console.log("✓ pixel-art (60 frames, 480×480, pulsing sprite)");
}

// ─────────────────────────────────────────────
// Run all generators
// ─────────────────────────────────────────────
async function main() {
  console.log(`\nGenerating test fixtures in ${FIXTURES_DIR}\n`);
  ensureDir(FIXTURES_DIR);

  generateSolid();
  generateTwoFrame();
  generateGradient();
  generateColorWheel();
  generateScreencast();
  generateShapes();
  generateSkinTones();
  generatePixelArt();

  console.log("\n✓ All fixtures generated.\n");
}

main().catch(console.error);
