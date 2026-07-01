/**
 * Browser benchmark server.
 *
 * Run: npx tsx test/browser/gifski-server.ts
 * Open: http://localhost:3333/test/browser/
 *
 * Provides /api/gifski and /api/gifhero endpoints for CLI comparison.
 * Both endpoints extract frames with the same ffmpeg pipeline so the
 * input is identical. Both encoders run at their default settings.
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

const server = createServer(async (req, res) => {
  // ── /api/gifski endpoint ──
  // gifski CLI needs pre-extracted PNG frames (no video input).
  // Frames extracted at native resolution; gifski handles downscaling via --width.
  if (req.method === "POST" && req.url === "/api/gifski") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const parsed = parseMultipart(Buffer.concat(chunks), req.headers["content-type"] ?? "");
    if (!parsed?.videoData) { res.writeHead(400); res.end("No video file"); return; }

    const fps = parsed.fields.fps ?? "20";
    const width = parsed.fields.width ?? "480";

    const tmpDir = join(tmpdir(), "gifhero-bench-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const inputPath = join(tmpDir, `input${parsed.fileExt}`);
    const framesDir = join(tmpDir, "frames");
    const outputPath = join(tmpDir, "output.gif");
    mkdirSync(framesDir, { recursive: true });

    writeFileSync(inputPath, parsed.videoData);

    try {
      const t0 = Date.now();

      // Extract frames at native resolution, capped at 20s.
      // Use -frames:v to match the browser's frame count (fps * min(duration, 20)).
      const probeOut = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${inputPath}"`,
        { timeout: 10000 },
      ).toString().trim();
      const duration = Math.min(parseFloat(probeOut) || 20, 20);
      const maxFrames = Math.ceil(duration * parseInt(fps));
      execSync(
        `ffmpeg -y -i "${inputPath}" -vf "fps=${fps}" -frames:v ${maxFrames} "${framesDir}/%04d.png"`,
        { stdio: "ignore", timeout: 60000 },
      );
      const frameCount = readdirSync(framesDir).filter(f => f.endsWith(".png")).length;

      // gifski at default settings with its own internal downscaling
      execSync(
        `gifski --fps ${fps} --width ${width} -o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" },
      );

      const gif = readFileSync(outputPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[gifski CLI] ${(gif.length / 1024).toFixed(0)} KB in ${elapsed}s (${frameCount} frames, ${fps}fps, ${width}px, default q)`);

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
  // gifhero CLI accepts video files directly (has its own ffmpeg pipeline)
  if (req.method === "POST" && req.url === "/api/gifhero") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const parsed = parseMultipart(Buffer.concat(chunks), req.headers["content-type"] ?? "");
    if (!parsed?.videoData) { res.writeHead(400); res.end("No video file"); return; }

    const fps = parsed.fields.fps ?? "20";
    const width = parsed.fields.width ?? "480";
    const preset = parsed.fields.preset ?? "balanced";

    const tmpDir = join(tmpdir(), "gifhero-cli-bench-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const inputPath = join(tmpDir, `input${parsed.fileExt}`);
    const outputPath = join(tmpDir, "output.gif");

    writeFileSync(inputPath, parsed.videoData);

    const gifheroBin = join(import.meta.dirname, "../../packages/gifhero-core/target/release/gifhero");

    try {
      const t0 = Date.now();

      // Cap duration to match the browser's 20s limit
      const probeOut = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${inputPath}"`,
        { timeout: 10000 },
      ).toString().trim();
      const maxDur = Math.min(parseFloat(probeOut) || 20, 20);

      execSync(
        `"${gifheroBin}" "${inputPath}" -w ${width} --fps ${fps} --max-duration ${maxDur} --preset ${preset} -o "${outputPath}" -q`,
        { stdio: "ignore", timeout: 120000 },
      );

      const gif = readFileSync(outputPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[gifhero CLI] ${(gif.length / 1024).toFixed(0)} KB in ${elapsed}s (${fps}fps, ${width}px, ${preset})`);

      res.writeHead(200, {
        "Content-Type": "image/gif",
        "Content-Length": String(gif.length),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(gif);
    } catch (err) {
      console.error("[gifhero CLI] Error:", (err as Error).message);
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
