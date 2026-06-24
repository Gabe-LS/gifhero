import type { ExtractedFrames } from "../types.js";

/**
 * File source for the video worker pipeline.
 *
 * Transfers the raw video file to the video worker where it's
 * demuxed and decoded using Mediabunny + VideoDecoder. The main
 * thread does no frame extraction — everything happens in the worker.
 */
export class FileSource {
  constructor(
    private file: Blob | File,
  ) {}

  /** Returns the video file as an ArrayBuffer for transfer to the worker. */
  async getBuffer(): Promise<ArrayBuffer> {
    return await this.file.arrayBuffer();
  }
}
