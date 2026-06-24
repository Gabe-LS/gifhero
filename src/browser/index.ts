/**
 * gifhero Browser SDK.
 *
 * Fluent API for creating GIFs from browser sources — video elements,
 * canvas, media streams, blobs, and raw pixel data. Encoding runs in
 * a Web Worker by default for non-blocking UI.
 *
 * @example
 * ```typescript
 * import { gifhero } from "gifhero/browser";
 *
 * const gif = await gifhero
 *   .fromVideo(videoElement)
 *   .fps(20)
 *   .width(480)
 *   .preset("quality")
 *   .toGif();
 * ```
 *
 * @module
 */

export * from "../index.js";

export { GifHeroBuilder } from "./builder.js";
export type {
  GifProgress,
  GifRecorder,
  VideoSourceOptions,
  StreamSourceOptions,
  CanvasSourceOptions,
  ExtractedFrames,
  DeferredFrames,
  FrameSource,
} from "./types.js";

import { GifHeroBuilder } from "./builder.js";
import { VideoSource } from "./sources/video.js";
import { CanvasSource } from "./sources/canvas.js";
import { StreamSource } from "./sources/stream.js";
import { FramesSource } from "./sources/frames.js";
import { BlobSource } from "./sources/blob.js";
import type { VideoSourceOptions, StreamSourceOptions, CanvasSourceOptions } from "./types.js";

/** Fluent entry points for creating GIFs from browser sources. */
export const gifhero = {
  /**
   * Create a GIF from an HTML video element.
   *
   * Extracts frames by seeking through the video at the configured FPS.
   *
   * @param video - An HTMLVideoElement with a loaded source.
   * @param options - Optional start/end time and FPS.
   */
  fromVideo(video: HTMLVideoElement, options?: VideoSourceOptions): GifHeroBuilder {
    return new GifHeroBuilder(new VideoSource(video, options));
  },

  /**
   * Create a GIF from a Canvas or OffscreenCanvas.
   *
   * Single frame by default. Set `frameCount` to capture an animation.
   *
   * @param canvas - An HTMLCanvasElement or OffscreenCanvas.
   * @param options - Frame count and FPS for multi-frame capture.
   */
  fromCanvas(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    options?: CanvasSourceOptions,
  ): GifHeroBuilder {
    return new GifHeroBuilder(new CanvasSource(canvas, options));
  },

  /**
   * Create a GIF from a MediaStream (webcam, screen capture).
   *
   * Use `.duration(seconds)` for auto-stop, or `.record()` for manual control.
   *
   * @param stream - A MediaStream from getUserMedia or getDisplayMedia.
   * @param options - FPS setting.
   */
  fromStream(stream: MediaStream, options?: StreamSourceOptions): GifHeroBuilder {
    return new GifHeroBuilder(new StreamSource(stream, options));
  },

  /**
   * Create a GIF from raw pixel data.
   *
   * Accepts ImageData objects or raw RGBA Uint8ClampedArrays.
   *
   * @param frames - Array of ImageData or Uint8ClampedArray (RGBA).
   * @param width - Frame width in pixels.
   * @param height - Frame height in pixels.
   */
  fromFrames(
    frames: Array<ImageData | Uint8ClampedArray>,
    width: number,
    height: number,
  ): GifHeroBuilder {
    return new GifHeroBuilder(new FramesSource(frames, width, height));
  },

  /**
   * Create a GIF from a video Blob or File.
   *
   * Loads the blob into a temporary video element for frame extraction.
   *
   * @param blob - A Blob or File containing video data.
   * @param options - Optional start/end time and FPS.
   */
  fromBlob(blob: Blob | File, options?: VideoSourceOptions): GifHeroBuilder {
    return new GifHeroBuilder(new BlobSource(blob, options));
  },
};
