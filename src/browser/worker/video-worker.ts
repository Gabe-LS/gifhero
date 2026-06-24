/**
 * Video-to-GIF worker using Mediabunny demuxer + VideoDecoder.
 *
 * Handles the full pipeline inside a Web Worker:
 * demux → decode → downsample → probe → store ImageBitmap
 * → materialize → encode → return GIF
 */

import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import type { InputVideoTrack, EncodedPacket } from "mediabunny";
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
  lossyLzw?: number;
  maxColors?: number;
  loop: number;
}

wlog("Video worker loaded");

self.onmessage = async (e: MessageEvent<VideoEncodeRequest>) => {
  const { type, id, videoBuffer, fps, targetWidth, preset, lossyLzw, maxColors, loop } = e.data;
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

    // ── Step 2: Compute extraction geometry ──
    let extractW = srcW;
    let extractH = srcH;
    if (targetWidth && targetWidth < srcW) {
      const ideal = targetWidth * 3;
      if (srcW > ideal * 1.15) {
        extractW = Math.min(ideal, 1920);
        extractH = Math.floor(srcH * (extractW / srcW));
      }
    } else if (srcW > 2560) {
      extractW = 1920;
      extractH = Math.floor(srcH * (extractW / srcW));
    }
    wlog(`Extraction size: ${extractW}×${extractH}`);

    // ── Step 3: Decode all frames via VideoDecoder ──
    const canvas = new OffscreenCanvas(extractW, extractH);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const probe = new IncrementalProbe(extractW, extractH);
    const bitmaps: ImageBitmap[] = [];
    const interval = 1 / fps;
    const delay = Math.round(1000 / fps);

    const decodedFrames: { timestamp: number; bitmap: ImageBitmap }[] = [];

    const decoder = new VideoDecoder({
      output: async (frame: VideoFrame) => {
        const ts = frame.timestamp / 1e6;
        ctx.drawImage(frame, 0, 0, extractW, extractH);
        frame.close();
        const bitmap = await createImageBitmap(canvas);
        decodedFrames.push({ timestamp: ts, bitmap });
      },
      error: (err: DOMException) => {
        wlog("VideoDecoder error:", err.message);
      },
    });

    decoder.configure(decoderConfig);

    // Feed packets to decoder
    let packet: EncodedPacket | null = await videoTrack.getFirstPacket({});
    let packetCount = 0;
    while (packet) {
      const chunk = new EncodedVideoChunk({
        type: packet.type === "key" ? "key" : "delta",
        timestamp: packet.timestamp * 1e6,
        duration: packet.duration * 1e6,
        data: packet.data,
      });
      decoder.decode(chunk);
      packetCount++;
      packet = await videoTrack.getNextPacket(packet, {});
    }

    await decoder.flush();
    decoder.close();
    wlog(`Decoded ${decodedFrames.length} frames from ${packetCount} packets`);

    // ── Step 4: Sample at target FPS + probe ──
    decodedFrames.sort((a, b) => a.timestamp - b.timestamp);
    let nextSampleTime = 0;

    for (const { timestamp, bitmap } of decodedFrames) {
      if (timestamp >= nextSampleTime) {
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, extractW, extractH);
        probe.addFrame(imageData.data);
        bitmaps.push(bitmap);
        nextSampleTime = timestamp + interval;

        if (bitmaps.length % 20 === 0) {
          (self as any).postMessage({ type: "progress", id, phase: "extracting", progress: timestamp / duration });
        }
      } else {
        bitmap.close();
      }
    }
    decodedFrames.length = 0;

    const probeResult = probe.finalize();
    const extractMs = performance.now() - t0;
    wlog(`Probed ${bitmaps.length} frames in ${(extractMs / 1000).toFixed(1)}s (cc=${probeResult.colorComplexity}, motion=${probeResult.motionLevel.toFixed(3)})`);

    // ── Step 5: Materialize + encode ──
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

    const gif = await encode({
      width: extractW,
      height: extractH,
      frames,
      preset,
      loop,
      ...(targetWidth && targetWidth < extractW ? { targetWidth } : {}),
      ...(lossyLzw !== undefined ? { lossyLzw } : {}),
      ...(maxColors !== undefined ? { maxColors } : {}),
    });

    input.dispose();

    const encodeMs = performance.now() - t1;
    const totalMs = performance.now() - t0;
    wlog(`Encoding done: ${(gif.byteLength / 1024).toFixed(0)} KB in ${(encodeMs / 1000).toFixed(1)}s`);
    wlog(`Total: ${(totalMs / 1000).toFixed(1)}s (decode+probe ${(extractMs / 1000).toFixed(1)}s + encode ${(encodeMs / 1000).toFixed(1)}s)`);

    const buf = gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength);
    (self as any).postMessage({ type: "result", id, gif: buf }, [buf]);
  } catch (err) {
    console.error(`[gifhero-video ${new Date().toISOString().slice(11, 23)}] Error:`, err);
    (self as any).postMessage({ type: "error", id, message: (err as Error).message });
  }
};
