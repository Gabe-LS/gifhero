import type { FrameSource, ExtractedFrames, VideoSourceOptions } from "../types.js";
import { VideoSource } from "./video.js";

/**
 * Extract frames from a Blob or File (video).
 *
 * Creates a temporary object URL, loads it into a video element,
 * then delegates to VideoSource for frame extraction.
 */
export class BlobSource implements FrameSource {
  constructor(
    private blob: Blob | File,
    private options: VideoSourceOptions = {},
  ) {}

  async extract(
    onProgress?: (extracted: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ExtractedFrames> {
    const url = URL.createObjectURL(this.blob);

    try {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;

      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () =>
          reject(new Error("Failed to load video from Blob — is it a valid video format?")),
          { once: true },
        );
      });

      const source = new VideoSource(video, this.options);
      return await source.extract(onProgress, signal);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
