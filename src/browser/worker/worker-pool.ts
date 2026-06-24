import type { EncodeFrame, EncodeOptions } from "../../index.js";

interface WorkerResponse {
  type: "result" | "error";
  id: number;
  gif?: ArrayBuffer;
  message?: string;
}

export class EncoderWorker {
  private worker: Worker | null = null;
  private nextId = 0;

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const url = new URL("../browser-worker.js", import.meta.url);
    this.worker = new Worker(url, { type: "module" });
    return this.worker;
  }

  async encode(
    frames: EncodeFrame[],
    width: number,
    height: number,
    options: Partial<EncodeOptions>,
  ): Promise<Uint8Array> {
    const id = this.nextId++;
    const worker = this.getWorker();

    const frameBuffers: ArrayBuffer[] = [];
    const delays: number[] = [];

    for (const f of frames) {
      const buf = f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength);
      frameBuffers.push(buf);
      delays.push(f.delay ?? 100);
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const handler = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.id !== id) return;
        worker.removeEventListener("message", handler);

        if (e.data.type === "result" && e.data.gif) {
          resolve(new Uint8Array(e.data.gif));
        } else {
          reject(new Error(e.data.message ?? "Worker encoding failed"));
        }
      };

      worker.addEventListener("message", handler);
      worker.postMessage(
        { type: "encode", id, frameBuffers, delays, width, height, options },
        frameBuffers,
      );
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
