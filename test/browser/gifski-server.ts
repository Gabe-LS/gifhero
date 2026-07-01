/**
 * Browser benchmark server.
 *
 * Run: npx tsx test/browser/gifski-server.ts
 * Open: http://localhost:3333/test/browser/
 *
 * Both CLI endpoints extract frames with the same ffmpeg pipeline at the
 * same snapped resolution the browser uses (3x target, integer ratio),
 * so all four encoders get equivalent input.
 */

import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

const PORT = 3333;
const ROOT = join(import.meta.dirname, "../..");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".gif": "image/gif",
  ".png": "image/png",
};

function serveFile(url: string): { data: Buffer; mime: string } | null {
  try {
    let filePath = url;
    if (filePath === "/" || filePath.endsWith("/")) filePath += "index.html";
    const path = join(ROOT, filePath);
    const data = readFileSync(path);
    const mime = MIME[extname(path)] ?? "application/octet-stream";
    return { data, mime };
  } catch {
    return null;
  }
}

function parseMultipart(body: Buffer, contentType: string) {
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) return null;

  const boundary = boundaryMatch[1];
  const parts = body.toString("binary").split(`--${boundary}`);
  const fields: Record<string, string> = {};
  let videoData: Buffer | null = null;
  let fileExt = ".mp4";

  for (const part of parts) {
    if (part.includes('name="video"')) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd < 0) continue;
      const header = part.slice(0, headerEnd);
      const filenameMatch = header.match(/filename="([^"]+)"/);
      if (filenameMatch) fileExt = extname(filenameMatch[1]) || ".mp4";
      const binaryData = part.slice(headerEnd + 4);
      const trimmed = binaryData.endsWith("\r\n") ? binaryData.slice(0, -2) : binaryData;
      videoData = Buffer.from(trimmed, "binary");
    } else {
      const nameMatch = part.match(/name="([^"]+)"/);
      if (nameMatch) {
        const val = part.split("\r\n\r\n")[1]?.trim().replace(/\r\n$/, "");
        if (val) fields[nameMatch[1]] = val;
      }
    }
  }

  return { videoData, fileExt, fields };
}

/**
 * Compute the snapped extraction size matching the browser's 3:1 logic.
 * Same algorithm as video-worker.ts lines 62-76.
 */
function computeExtractSize(srcW: number, srcH: number, targetWidth: number) {
  const longestSrc = Math.max(srcW, srcH);
  let extractW = srcW;
  let extractH = srcH;
  if (targetWidth < longestSrc) {
    const idealLong = targetWidth * 3;
    if (longestSrc > idealLong * 1.15) {
      const snapRatio = Math.round(longestSrc / idealLong);
      if (snapRatio >= 2) {
        extractW = Math.round(srcW / snapRatio);
        extractH = Math.round(srcH / snapRatio);
      }
    }
  }
  return { extractW, extractH };
}

/**
 * Extract frames with ffmpeg at the snapped resolution,
 * matching the browser's extraction approach.
 */
function extractFrames(
  inputPath: string, framesDir: string,
  fps: string, targetWidth: number, maxFrames?: number,
) {
  // Probe source dimensions
  const probeOut = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${inputPath}"`,
    { timeout: 10000 },
  ).toString().trim();
  const [srcW, srcH] = probeOut.split("x").map(Number);

  // Compute snapped extraction size (same as browser)
  const { extractW, extractH } = computeExtractSize(srcW, srcH, targetWidth);

  const maxFramesFlag = maxFrames ? `-frames:v ${maxFrames}` : "-t 20";
  const scaleFilter = (extractW < srcW)
    ? `fps=${fps},scale=${extractW}:${extractH}:flags=lanczos`
    : `fps=${fps}`;

  execSync(
    `ffmpeg -y -i "${inputPath}" -vf "${scaleFilter}" ${maxFramesFlag} "${framesDir}/%04d.png"`,
    { stdio: "ignore", timeout: 60000 },
  );

  const frameCount = readdirSync(framesDir).filter(f => f.endsWith(".png")).length;
  console.log(`[extract] ${srcW}x${srcH} → ${extractW}x${extractH}, ${frameCount} frames`);
  return { frameCount, extractW, extractH };
}

const server = createServer(async (req, res) => {
  // ── /api/gifski endpoint ──
  if (req.method === "POST" && req.url === "/api/gifski") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const parsed = parseMultipart(Buffer.concat(chunks), req.headers["content-type"] ?? "");
    if (!parsed?.videoData) { res.writeHead(400); res.end("No video file"); return; }

    const fps = parsed.fields.fps ?? "20";
    const width = parseInt(parsed.fields.width ?? "480");
    const maxFrames = parsed.fields.maxFrames ? parseInt(parsed.fields.maxFrames) : undefined;

    const tmpDir = join(tmpdir(), "gifhero-bench-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const inputPath = join(tmpDir, `input${parsed.fileExt}`);
    const framesDir = join(tmpDir, "frames");
    const outputPath = join(tmpDir, "output.gif");
    mkdirSync(framesDir, { recursive: true });

    writeFileSync(inputPath, parsed.videoData);

    try {
      const t0 = Date.now();
      const { frameCount } = extractFrames(inputPath, framesDir, fps, width, maxFrames);

      execSync(
        `gifski --fps ${fps} --width ${width} -o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" },
      );

      const gif = readFileSync(outputPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[gifski CLI] ${(gif.length / 1024).toFixed(0)} KB in ${elapsed}s (${frameCount} frames, ${fps}fps, ${width}px)`);

      res.writeHead(200, {
        "Content-Type": "image/gif",
        "Content-Length": String(gif.length),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(gif);
    } catch (err) {
      console.error("[gifski CLI] Error:", (err as Error).message);
      res.writeHead(500);
      res.end((err as Error).message);
    } finally {
      try { execSync(`rm -rf "${tmpDir}"`); } catch {}
    }
    return;
  }

  // ── /api/gifhero endpoint ──
  // Uses the Node.js SDK (same pipeline as browser) so both get the same
  // snapped-resolution PNGs. The Rust CLI can't read PNG sequences.
  if (req.method === "POST" && req.url === "/api/gifhero") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const parsed = parseMultipart(Buffer.concat(chunks), req.headers["content-type"] ?? "");
    if (!parsed?.videoData) { res.writeHead(400); res.end("No video file"); return; }

    const fps = parsed.fields.fps ?? "20";
    const width = parseInt(parsed.fields.width ?? "480");
    const preset = (parsed.fields.preset ?? "balanced") as "quality" | "balanced";
    const maxFrames = parsed.fields.maxFrames ? parseInt(parsed.fields.maxFrames) : undefined;

    const tmpDir = join(tmpdir(), "gifhero-cli-bench-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const inputPath = join(tmpDir, `input${parsed.fileExt}`);
    const framesDir = join(tmpDir, "frames");
    mkdirSync(framesDir, { recursive: true });

    writeFileSync(inputPath, parsed.videoData);

    try {
      const t0 = Date.now();
      const { frameCount, extractW, extractH } = extractFrames(inputPath, framesDir, fps, width, maxFrames);

      // Load PNGs and encode with gifhero Node.js SDK
      const { createCanvas, Image } = await import("canvas");
      const { encode } = await import("../../src/index.js");

      const pngFiles = readdirSync(framesDir).filter(f => f.endsWith(".png")).sort();
      const frames: Array<{ data: Uint8ClampedArray; delay: number }> = [];
      let frameW = 0, frameH = 0;

      for (const file of pngFiles) {
        const img = new Image();
        img.src = readFileSync(join(framesDir, file));
        if (!frameW) { frameW = img.width; frameH = img.height; }
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        frames.push({ data: ctx.getImageData(0, 0, img.width, img.height).data, delay: Math.round(1000 / parseInt(fps)) });
      }

      const gif = await encode({
        width: frameW,
        height: frameH,
        frames,
        preset,
        ...(width < frameW ? { targetWidth: width } : {}),
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[gifhero SDK] ${(gif.length / 1024).toFixed(0)} KB in ${elapsed}s (${frameCount} frames, ${fps}fps, ${width}px, ${preset})`);

      res.writeHead(200, {
        "Content-Type": "image/gif",
        "Content-Length": String(gif.length),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(gif);
    } catch (err) {
      console.error("[gifhero SDK] Error:", (err as Error).message);
      res.writeHead(500);
      res.end((err as Error).message);
    } finally {
      try { execSync(`rm -rf "${tmpDir}"`); } catch {}
    }
    return;
  }

  // ── /api/bench-results endpoint ──
  if (req.method === "GET" && req.url === "/api/bench-results") {
    const resultsDir = join(ROOT, "test/bench/results");
    try {
      const files = readdirSync(resultsDir)
        .filter(f => f.startsWith("bench-") && f.endsWith(".json"))
        .sort();
      const latest = files.length > 0 ? files[files.length - 1] : null;
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ latest, files }));
    } catch {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ latest: null, files: [] }));
    }
    return;
  }

  // ── Static file server ──
  const file = serveFile(req.url ?? "/");
  if (file) {
    res.writeHead(200, {
      "Content-Type": file.mime,
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    res.end(file.data);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`gifhero test server on http://localhost:${PORT}/`);
  console.log(`Open http://localhost:${PORT}/test/browser/ to test`);
});
