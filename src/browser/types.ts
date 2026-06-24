import type { EncodeFrame } from "../index.js";

/** Progress info passed to onProgress callback. */
export interface GifProgress {
  /** Current phase. */
  phase: "extracting" | "encoding";
  /** Progress within current phase, 0 to 1. */
  progress: number;
  /** Frames extracted so far (extracting phase only). */
  framesExtracted?: number;
  /** Total frames expected (extracting phase only). */
  totalFrames?: number;
}

/** Options for video frame extraction. */
export interface VideoSourceOptions {
  /** Frames per second to extract. Default 10. */
  fps?: number;
  /** Start time in seconds. Default 0. */
  startTime?: number;
  /** End time in seconds. Default video.duration. */
  endTime?: number;
}

/** Options for MediaStream capture. */
export interface StreamSourceOptions {
  /** Frames per second to capture. Default 10. */
  fps?: number;
}

/** Options for canvas recording. */
export interface CanvasSourceOptions {
  /** Number of frames to capture. Default 1 (single snapshot). */
  frameCount?: number;
  /** Frames per second for multi-frame capture. Default 10. */
  fps?: number;
}

/** Extracted frames ready for encoding. */
export interface ExtractedFrames {
  frames: EncodeFrame[];
  width: number;
  height: number;
}

/**
 * Lightweight frame store using ImageBitmap.
 * Pixel data lives in native/GPU memory, not the JS heap.
 * Converted to RGBA on demand via materialize().
 */
export interface DeferredFrames {
  bitmaps: ImageBitmap[];
  delays: number[];
  width: number;
  height: number;
  materialize(): ExtractedFrames;
}

/** Frame source: any input that can produce EncodeFrame[]. */
export interface FrameSource {
  extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames | DeferredFrames>;
}

/** Result from a MediaStream recording session. */
export interface GifRecorder {
  /** Stop recording and encode the captured frames. */
  stop(): Promise<Uint8Array>;
}
