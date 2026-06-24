import type { EncodeFrame } from "../../index.js";
import type { FrameSource, ExtractedFrames, VideoSourceOptions } from "../types.js";

/**
 * Extract frames from an HTMLVideoElement by seeking.
 *
 * Creates an offscreen canvas, seeks to each time position,
 * draws the video frame, and extracts RGBA pixel data.
 */
export class VideoSource implements FrameSource {
  constructor(
    private video: HTMLVideoElement,
    private options: VideoSourceOptions = {},
  ) {}

  async extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames> {
    const video = this.video;

    if (video.readyState < 1) {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error("Video failed to load")), { once: true });
      });
    }

    const fps = this.options.fps ?? 10;
    const start = this.options.startTime ?? 0;
    const end = this.options.endTime ?? video.duration;

    if (!isFinite(end) || end <= start) {
      throw new Error(`Invalid video time range: ${start}–${end}. Is the video loaded?`);
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    const interval = 1 / fps;
    const times: number[] = [];
    for (let t = start; t < end; t += interval) times.push(t);

    const delay = Math.round(1000 / fps);
    const frames: EncodeFrame[] = [];

    for (let i = 0; i < times.length; i++) {
      signal?.throwIfAborted();

      video.currentTime = times[i];
      await new Promise<void>((resolve) => {
        video.addEventListener("seeked", () => resolve(), { once: true });
      });

      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      frames.push({ data: imageData.data, delay });
      onProgress?.(i + 1, times.length);
    }

    return { frames, width, height };
  }
}
