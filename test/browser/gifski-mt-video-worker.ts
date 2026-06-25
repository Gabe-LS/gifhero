/**
 * gifski-wasm multi-threaded benchmark worker.
 *
 * Same VideoDecoder decode pipeline as the single-threaded version, but
 * uses gifski-wasm's parallel WASM build (Rayon via SharedArrayBuffer).
 *
 * The parallel module is loaded via dynamic import from a served URL so
 * that wasm-bindgen-rayon's sub-workers resolve their paths correctly.
 */

import { Input, BufferSource, ALL_FORMATS, VideoSampleSink } from "mediabunny";

function wlog(...args: any[]) {
  console.log(`[gifski-mt ${new Date().toISOString().slice(11, 23)}]`, ...args);
}

interface BenchRequest {
  type: "encode";
  id: number;
  videoBuffer: ArrayBuffer;
  fps: number;
  targetWidth?: number;
  quality: number;
  maxDuration?: number;
}

wlog("Worker loaded");

let wasmEncode: any = null;

async function initParallelGifski() {
  if (wasmEncode) return;

  const base = (self as any).location.href.replace(/\/[^/]*$/, "/");
  const modUrl = base + "pkg-parallel/gifski_wasm.js";
  wlog(`Loading parallel module from ${modUrl}`);

  const mod = await import(/* @vite-ignore */ modUrl);
  const wasmUrl = base + "pkg-parallel/gifski_wasm_bg.wasm";
  await mod.default(wasmUrl);

  const threads = Math.min(4, (globalThis.navigator as any)?.hardwareConcurrency ?? 4);
  wlog(`Initializing thread pool with ${threads} threads...`);
  await mod.initThreadPool(threads);
  wlog("Thread pool ready");

  wasmEncode = mod.encode;
}

self.onmessage = async (e: MessageEvent<BenchRequest>) => {
  const { type, id, videoBuffer, fps, targetWidth, quality, maxDuration } = e.data;
  if (type !== "encode") return;

  try {
    await initParallelGifski();

    wlog(`Received video: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
    const t0 = performance.now();

    // ── Demux ──
    const input = new Input({
      source: new BufferSource(new Uint8Array(videoBuffer)),
      formats: ALL_FORMATS,
    });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("No video track");
    const decoderConfig = await videoTrack.getDecoderConfig();
    if (!decoderConfig) throw new Error("No decoder config");
    const srcW = decoderConfig.codedWidth ?? 0;
    const srcH = decoderConfig.codedHeight ?? 0;
    const duration = await input.getDurationFromMetadata([videoTrack]) ?? await input.computeDuration([videoTrack]);

    const longestSrc = Math.max(srcW, srcH);
    let extractW = srcW;
    let extractH = srcH;
    let finalW = srcW;
    let finalH = srcH;
    if (targetWidth && targetWidth < longestSrc) {
      const finalScale = Math.min(1, targetWidth / longestSrc);
      finalW = Math.round(srcW * finalScale);
      finalH = Math.round(srcH * finalScale);
      const idealLong = targetWidth * 3;
      if (longestSrc > idealLong * 1.15) {
        const snapRatio = Math.round(longestSrc / idealLong);
        if (snapRatio >= 2) {
          extractW = Math.round(srcW / snapRatio);
          extractH = Math.round(srcH / snapRatio);
        }
      }
    }

    wlog(`Demuxed: ${srcW}×${srcH} → extract ${finalW}×${finalH}, ${duration.toFixed(1)}s`);

    // ── Decode directly to final target size ──
    // Multi-threaded WASM uses SharedArrayBuffer which can't grow after
    // being shared with rayon workers. Decoding at full extraction size
    // then passing 1GB+ to WASM hits the memory limit. Decode directly
    // to the final target size instead — canvas.drawImage handles the
    // downscale, matching what a real browser app would do.
    const canvas = new OffscreenCanvas(finalW, finalH);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const sink = new VideoSampleSink(videoTrack);
    const frames: Uint8Array[] = [];
    const interval = 1 / fps;
    const maxTs = maxDuration ?? Infinity;
    let nextSampleTime = 0;
    let decoded = 0;

    for await (const sample of sink.samples()) {
      decoded++;
      const ts = sample.timestamp ?? 0;
      if (ts > maxTs) { sample.close(); break; }

      if (ts >= nextSampleTime) {
        const vf = sample.toVideoFrame();
        ctx.drawImage(vf, 0, 0, finalW, finalH);
        vf.close();
        const imageData = ctx.getImageData(0, 0, finalW, finalH);
        frames.push(new Uint8Array(imageData.data.buffer));
        nextSampleTime = ts + interval;

        if (frames.length % 20 === 0) {
          (self as any).postMessage({ type: "progress", id, phase: "extracting", progress: ts / Math.min(duration, maxTs) });
        }
      }
      sample.close();
    }
    input.dispose();

    const extractMs = performance.now() - t0;
    wlog(`Decoded ${decoded}, sampled ${frames.length} frames in ${(extractMs / 1000).toFixed(1)}s`);

    // ── Concatenate frames into single buffer ──
    const frameSize = finalW * finalH * 4;
    const framesBuffer = new Uint8Array(frameSize * frames.length);
    for (let i = 0; i < frames.length; i++) {
      framesBuffer.set(frames[i], i * frameSize);
    }
    wlog(`Frame buffer: ${(framesBuffer.byteLength / 1024 / 1024).toFixed(0)} MB`);

    // ── Encode with multi-threaded gifski (no resize needed) ──
    (self as any).postMessage({ type: "progress", id, phase: "encoding", progress: 0 });
    wlog(`Encoding ${frames.length} frames at ${finalW}×${finalH} q${quality} (multi-threaded)...`);
    const t1 = performance.now();

    const gif = wasmEncode(
      framesBuffer,
      frames.length,
      finalW,
      finalH,
      fps,
      undefined,
      quality,
      undefined,
      undefined,
      undefined,
    );

    const encodeMs = performance.now() - t1;
    const totalMs = performance.now() - t0;
    wlog(`Done: ${(gif.byteLength / 1024).toFixed(0)} KB in ${(totalMs / 1000).toFixed(1)}s (decode ${(extractMs / 1000).toFixed(1)}s + encode ${(encodeMs / 1000).toFixed(1)}s)`);

    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
    (self as any).postMessage({ type: "result", id, gif: buf, encodeTime: encodeMs, totalTime: totalMs }, [buf]);
  } catch (err) {
    console.error(`[gifski-mt] Error:`, err);
    (self as any).postMessage({ type: "error", id, message: (err as Error).message });
  }
};
