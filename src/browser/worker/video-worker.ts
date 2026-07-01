/**
 * Video-to-GIF worker using Mediabunny + VideoDecoder (via VideoSampleSink).
 *
 * Full pipeline in a Web Worker:
 * demux → decode (VideoSampleSink) → downsample → probe → ImageBitmap
 * → materialize → encode → return GIF
 */

import { Input, BufferSource, ALL_FORMATS, VideoSampleSink } from "mediabunny";
import { encode, IncrementalProbe } from "../../index.js";
import type { EncodeFrame } from "../../index.js";

function wlog(...args: any[]) {
  console.log(`[gifhero-video ${new Date().toISOString().slice(11, 23)}]`, ...args);
}

interface VideoEncodeRequest {
  type: "encode-video";
  id: number;
  videoBuffer: ArrayBuffer;
  fps: number;
  targetWidth?: number;
  preset: "quality" | "balanced";
  maxDuration?: number;
  lossyLzw?: number;
  maxColors?: number;
  loop: number;
}

wlog("Video worker loaded");

self.onmessage = async (e: MessageEvent<VideoEncodeRequest>) => {
  const { type, id, videoBuffer, fps, targetWidth, preset, maxDuration, lossyLzw, maxColors, loop } = e.data;
  if (type !== "encode-video") return;

  try {
    wlog(`Received video: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(1)} MB, fps=${fps}, target=${targetWidth ?? "native"}`);
    const t0 = performance.now();

    // ── Step 1: Demux ──
    wlog("Demuxing...");
    const input = new Input({
      source: new BufferSource(new Uint8Array(videoBuffer)),
      formats: ALL_FORMATS,
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("No video track found in file");

    const decoderConfig = await videoTrack.getDecoderConfig();
    if (!decoderConfig) throw new Error("Could not get decoder config from video track");

    const srcW = decoderConfig.codedWidth ?? 0;
    const srcH = decoderConfig.codedHeight ?? 0;
    if (!srcW || !srcH) throw new Error("Could not determine video dimensions");

    const duration = await input.getDurationFromMetadata([videoTrack]) ?? await input.computeDuration([videoTrack]);
    wlog(`Demuxed: ${srcW}×${srcH}, ${duration.toFixed(1)}s, codec=${decoderConfig.codec}`);

    // Pre-downscale via drawImage only if the source is significantly
    // larger than 3× the target (15% tolerance). When downscaling,
    // snap to the nearest integer ratio for clean bilinear sampling.
    let extractW = srcW;
    let extractH = srcH;
    const longestSrc = Math.max(srcW, srcH);
    if (targetWidth && targetWidth < longestSrc) {
      const idealLong = targetWidth * 3;
      if (longestSrc > idealLong * 1.15) {
        const rawRatio = longestSrc / idealLong;
        const snapRatio = Math.round(rawRatio);
        if (snapRatio >= 2) {
          extractW = Math.round(srcW / snapRatio);
          extractH = Math.round(srcH / snapRatio);
        }
      }
    }
    wlog(`Extraction size: ${extractW}×${extractH}${extractW < srcW ? ` (${Math.round(srcW/extractW)}:1 snap)` : " (full resolution)"}`);

    // ── Step 3: Decode + sample at target FPS + probe ──
    const canvas = new OffscreenCanvas(extractW, extractH);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const probe = new IncrementalProbe(extractW, extractH);
    const bitmaps: ImageBitmap[] = [];
    const interval = 1 / fps;
    const delay = Math.round(1000 / fps);

    const sink = new VideoSampleSink(videoTrack);
    let nextSampleTime = 0;
    let decoded = 0;

    const maxTs = maxDuration ?? Infinity;

    for await (const sample of sink.samples()) {
      decoded++;
      const ts = sample.timestamp ?? 0;

      if (ts > maxTs) { sample.close(); break; }

      if (ts >= nextSampleTime) {
        const videoFrame = sample.toVideoFrame();
        ctx.drawImage(videoFrame, 0, 0, extractW, extractH);
        videoFrame.close();

        const imageData = ctx.getImageData(0, 0, extractW, extractH);
        probe.addFrame(imageData.data);
        const bitmap = await createImageBitmap(canvas);
        bitmaps.push(bitmap);
        nextSampleTime = ts + interval;

        if (bitmaps.length % 20 === 0) {
          (self as any).postMessage({ type: "progress", id, phase: "extracting", progress: ts / duration });
        }
      }

      sample.close();
    }

    const probeResult = probe.finalize();
    const extractMs = performance.now() - t0;
    wlog(`Decoded ${decoded} frames, sampled ${bitmaps.length} at ${fps}fps in ${(extractMs / 1000).toFixed(1)}s`);
    wlog(`Probe: cc=${probeResult.colorComplexity}, motion=${probeResult.motionLevel.toFixed(3)}, scenes=${probeResult.sceneChanges.length}`);

    // ── Step 4: Materialize + encode ──
    (self as any).postMessage({ type: "progress", id, phase: "encoding", progress: 0 });
    wlog(`Encoding ${bitmaps.length} frames...`);
    const t1 = performance.now();

    const encCanvas = new OffscreenCanvas(extractW, extractH);
    const encCtx = encCanvas.getContext("2d", { willReadFrequently: true })!;
    const frames: EncodeFrame[] = [];

    for (let i = 0; i < bitmaps.length; i++) {
      encCtx.drawImage(bitmaps[i], 0, 0);
      frames.push({
        data: encCtx.getImageData(0, 0, extractW, extractH).data,
        delay,
      });
      bitmaps[i].close();
    }
    bitmaps.length = 0;

    // targetWidth constrains the longest dimension.
    let finalTargetWidth: number | undefined;
    if (targetWidth) {
      const longestSrc = Math.max(srcW, srcH);
      const scale = Math.min(1, targetWidth / longestSrc);
      finalTargetWidth = Math.round(srcW * scale);
    }

    const gif = await encode({
      width: extractW,
      height: extractH,
      frames,
      preset,
      loop,
      ...(finalTargetWidth && finalTargetWidth < extractW ? { targetWidth: finalTargetWidth } : {}),
      ...(lossyLzw !== undefined ? { lossyLzw } : {}),
      ...(maxColors !== undefined ? { maxColors } : {}),
    });

    input.dispose();

    const encodeMs = performance.now() - t1;
    const totalMs = performance.now() - t0;
    wlog(`Done: ${(gif.byteLength / 1024).toFixed(0)} KB in ${(totalMs / 1000).toFixed(1)}s (decode ${(extractMs / 1000).toFixed(1)}s + encode ${(encodeMs / 1000).toFixed(1)}s)`);

    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
    (self as any).postMessage({ type: "result", id, gif: buf, frameCount: frames.length }, [buf]);
  } catch (err) {
    console.error(`[gifhero-video ${new Date().toISOString().slice(11, 23)}] Error:`, err);
    (self as any).postMessage({ type: "error", id, message: (err as Error).message });
  }
};
