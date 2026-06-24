import type { EncodeFrame } from "../../index.js";
import type { FrameSource, ExtractedFrames, StreamSourceOptions } from "../types.js";

/**
 * Capture frames from a MediaStream (webcam, screen recording).
 *
 * Creates a hidden video element fed by the stream, captures frames
 * at the configured FPS via canvas.drawImage. Requires either a
 * duration limit or manual stop via the builder's record() API.
 */
export class StreamSource implements FrameSource {
  private _duration?: number;
  private _targetWidth?: number;
  private _stopResolve?: (result: ExtractedFrames) => void;
  private _recording = false;

  constructor(
    private stream: MediaStream,
    private options: StreamSourceOptions = {},
  ) {}

  set duration(seconds: number | undefined) { this._duration = seconds; }
  set targetWidth(w: number | undefined) { this._targetWidth = w; }

  async extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames> {
    if (!this._duration) {
      throw new Error(
        "MediaStream source requires .duration(seconds) to set a recording limit, " +
        "or use .record() for manual stop control.",
      );
    }
    return this._capture(this._duration, onProgress, signal);
  }

  startRecording(
    fps: number,
    duration: number | undefined,
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames> {
    this.options.fps = fps;
    const maxDuration = duration ?? Infinity;
    return this._capture(maxDuration, onProgress, signal);
  }

  private async _capture(
    maxDuration: number,
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames> {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;

    await new Promise<void>((resolve) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    });
    await video.play();

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    let width = srcW;
    let height = srcH;
    if (this._targetWidth && this._targetWidth < srcW) {
      width = Math.min(srcW, this._targetWidth * 2);
      height = Math.floor(srcH * (width / srcW));
    }
    const fps = this.options.fps ?? 10;
    const interval = 1000 / fps;
    const delay = Math.round(interval);
    const totalFrames = isFinite(maxDuration) ? Math.ceil(maxDuration * fps) : 0;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const frames: EncodeFrame[] = [];
    const startTime = performance.now();

    return new Promise<ExtractedFrames>((resolve) => {
      const stop = () => {
        video.pause();
        video.srcObject = null;
        resolve({ frames, width, height });
      };

      const captureFrame = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        if (signal?.aborted || elapsed >= maxDuration) {
          stop();
          return;
        }

        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        frames.push({ data: imageData.data, delay });
        onProgress?.(frames.length, totalFrames || frames.length);

        setTimeout(captureFrame, interval);
      };

      captureFrame();

      this.stream.getTracks().forEach(track => {
        track.addEventListener("ended", stop, { once: true });
      });
    });
  }
}
