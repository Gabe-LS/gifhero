/**
 * Local gifski encoding server for browser benchmark comparison.
 *
 * Run: npx tsx test/browser/gifski-server.ts
 * Serves the test page AND provides /api/gifski endpoint.
 *
 * POST /api/gifski
 *   Body: FormData with "video" (file), "fps" (string), "width" (string)
 *   Returns: GIF binary
 */

import { createServer } from "http";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from "fs";
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

const server = createServer(async (req, res) => {
  // ── /api/gifski endpoint ──
  if (req.method === "POST" && req.url === "/api/gifski") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    // Parse multipart form data (simple parser)
    const contentType = req.headers["content-type"] ?? "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) { res.writeHead(400); res.end("No boundary"); return; }

    const boundary = boundaryMatch[1];
    const parts = body.toString("binary").split(`--${boundary}`);
    let videoData: Buffer | null = null;
    let fps = "10";
    let width = "480";
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
      } else if (part.includes('name="fps"')) {
        const val = part.split("\r\n\r\n")[1]?.trim().replace(/\r\n$/, "");
        if (val) fps = val;
      } else if (part.includes('name="width"')) {
        const val = part.split("\r\n\r\n")[1]?.trim().replace(/\r\n$/, "");
        if (val) width = val;
      }
    }

    if (!videoData) { res.writeHead(400); res.end("No video file"); return; }

    const tmpDir = join(tmpdir(), "gifhero-bench-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const inputPath = join(tmpDir, `input${fileExt}`);
    const framesDir = join(tmpDir, "frames");
    const outputPath = join(tmpDir, "output.gif");
    mkdirSync(framesDir, { recursive: true });

    writeFileSync(inputPath, videoData);

    try {
      const t0 = Date.now();

      // Extract frames with ffmpeg
      execSync(
        `ffmpeg -y -i "${inputPath}" -t 20 -vf "fps=${fps},scale='min(${width},iw)':'min(${width},ih)':force_original_aspect_ratio=decrease" "${framesDir}/%04d.png"`,
        { stdio: "ignore", timeout: 60000 },
      );

      // Encode with gifski
      execSync(
        `gifski --fps ${fps} --width ${width} -o "${outputPath}" "${framesDir}"/*.png`,
        { stdio: "ignore", timeout: 120000, shell: "/bin/bash" },
      );

      const gif = readFileSync(outputPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[gifski] ${(gif.length / 1024).toFixed(0)} KB in ${elapsed}s (${fps}fps, ${width}px)`);

      res.writeHead(200, {
        "Content-Type": "image/gif",
        "Content-Length": String(gif.length),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(gif);
    } catch (err) {
      console.error("[gifski] Error:", (err as Error).message);
      res.writeHead(500);
      res.end((err as Error).message);
    } finally {
      try { execSync(`rm -rf "${tmpDir}"`); } catch {}
    }
    return;
  }

  // ── /api/gifhero endpoint ──
  if (req.method === "POST" && req.url === "/api/gifhero") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const contentType = req.headers["content-type"] ?? "";
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) { res.writeHead(400); res.end("No boundary"); return; }

    const boundary = boundaryMatch[1];
    const parts = body.toString("binary").split(`--${boundary}`);
    let videoData: Buffer | null = null;
    let fps = "20";
    let width = "480";
    let preset = "balanced";
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
      } else if (part.includes('name="fps"')) {
        const val = part.split("\r\n\r\n")[1]?.trim().replace(/\r\n$/, "");
        if (val) fps = val;
      } else if (part.includes('name="width"')) {
        const val = part.split("\r\n\r\n")[1]?.trim().replace(/\r\n$/, "");
        if (val) width = val;
      } else if (part.includes('name="preset"')) {
        const val = part.split("\r\n\r\n")[1]?.trim().replace(/\r\n$/, "");
        if (val) preset = val;
      }
    }

    if (!videoData) { res.writeHead(400); res.end("No video file"); return; }

    const tmpDir = join(tmpdir(), "gifhero-cli-bench-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    const inputPath = join(tmpDir, `input${fileExt}`);
    const outputPath = join(tmpDir, "output.gif");

    writeFileSync(inputPath, videoData);

    const gifheroBin = join(import.meta.dirname, "../../packages/gifhero-core/target/release/gifhero");

    try {
      const t0 = Date.now();

      // Probe video dimensions to compute target width (longest dimension = width param)
      const probeOut = execSync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${inputPath}"`,
        { timeout: 10000 },
      ).toString().trim();
      const [srcW, srcH] = probeOut.split("x").map(Number);
      const longestSrc = Math.max(srcW, srcH);
      const targetW = Math.round(srcW * Math.min(1, parseInt(width) / longestSrc));

      execSync(
        `"${gifheroBin}" "${inputPath}" -w ${targetW} --fps ${fps} --max-duration 20 --preset ${preset} -o "${outputPath}" -q`,
        { stdio: "ignore", timeout: 120000 },
      );

      const gif = readFileSync(outputPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[gifhero-cli] ${(gif.length / 1024).toFixed(0)} KB in ${elapsed}s (${fps}fps, ${width}px, ${preset})`);

      res.writeHead(200, {
        "Content-Type": "image/gif",
        "Content-Length": String(gif.length),
        "Access-Control-Allow-Origin": "*",
      });
      res.end(gif);
    } catch (err) {
      console.error("[gifhero-cli] Error:", (err as Error).message);
      res.writeHead(500);
      res.end((err as Error).message);
    } finally {
      try { execSync(`rm -rf "${tmpDir}"`); } catch {}
    }
    return;
  }

  // ── /api/bench-results endpoint (list latest benchmark JSON) ──
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
  console.log(`gifhero test server + gifski API on http://localhost:${PORT}/`);
  console.log(`Open http://localhost:${PORT}/test/browser/ to test`);
  console.log(`gifski benchmark available at POST /api/gifski`);
});
