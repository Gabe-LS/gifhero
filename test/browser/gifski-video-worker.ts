/**
 * gifski-wasm benchmark worker with VideoDecoder extraction.
 *
 * Same decode pipeline as gifhero's video-worker: Mediabunny demux
 * → VideoDecoder → extract at target size → encode with gifski-wasm.
 * This ensures both encoders get the same quality input for a fair
 * comparison.
 */

import { Input, BufferSource, ALL_FORMATS, VideoSampleSink } from "mediabunny";
import type { InputVideoTrack } from "mediabunny";
import { init as initGifski, encode as encodeGifski } from "gifski-wasm";

function wlog(...args: any[]) {
  console.log(`[gifski-bench ${new Date().toISOString().slice(11, 23)}]`, ...args);
}

interface BenchRequest {
  type: "encode";
  id: number;
  videoBuffer: ArrayBuffer;
  fps: number;
  targetWidth?: number;
  quality: number;
  maxDuration?: number;
  wasmUrl: string;
}

wlog("Worker loaded");

self.onmessage = async (e: MessageEvent<BenchRequest>) => {
  const { type, id, videoBuffer, fps, targetWidth, quality, maxDuration, wasmUrl } = e.data;
  if (type !== "encode") return;

  try {
    wlog("Initializing gifski WASM...");
    await initGifski(wasmUrl);

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

    // Same snapped extraction as gifhero: 3× target, integer ratio,
    // 15% tolerance. Both encoders get the same input frames.
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

    wlog(`Demuxed: ${srcW}×${srcH} → extract ${extractW}×${extractH} → final ${finalW}×${finalH}, ${duration.toFixed(1)}s`);

    // ── Decode + extract at snapped size ──
    const canvas = new OffscreenCanvas(extractW, extractH);
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
        ctx.drawImage(vf, 0, 0, extractW, extractH);
        vf.close();
        const imageData = ctx.getImageData(0, 0, extractW, extractH);
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

    // ── Encode with gifski-wasm ──
    (self as any).postMessage({ type: "progress", id, phase: "encoding", progress: 0 });
    const needsResize = finalW < extractW;
    wlog(`Encoding ${frames.length} frames at ${extractW}×${extractH}${needsResize ? ` → resize to ${finalW}` : ""} q${quality}...`);
    const t1 = performance.now();

    const gif = await encodeGifski({
      frames,
      width: extractW,
      height: extractH,
      fps,
      quality,
      ...(needsResize ? { resizeWidth: finalW } : {}),
    });

    const encodeMs = performance.now() - t1;
    const totalMs = performance.now() - t0;
    wlog(`Done: ${(gif.byteLength / 1024).toFixed(0)} KB in ${(totalMs / 1000).toFixed(1)}s (decode ${(extractMs / 1000).toFixed(1)}s + encode ${(encodeMs / 1000).toFixed(1)}s)`);

    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
    (self as any).postMessage({ type: "result", id, gif: buf, encodeTime: encodeMs, totalTime: totalMs }, [buf]);
  } catch (err) {
    console.error(`[gifski-bench ${new Date().toISOString().slice(11, 23)}] Error:`, err);
    (self as any).postMessage({ type: "error", id, message: (err as Error).message });
  }
};
