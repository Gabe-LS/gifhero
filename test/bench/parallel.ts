/**
 * Parallel GIF encoding via worker threads.
 *
 * Each encode job runs in its own worker thread with an independent
 * V8 isolate and WASM instance, bypassing Node.js's single-threaded
 * event loop for CPU-bound imagequant work.
 */

import { Worker } from "worker_threads";
import { cpus } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { EncodeOptions } from "../../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "encode-worker.ts");

export interface EncodeJob {
  frames: Array<{ data: Uint8ClampedArray; delay: number }>;
  width: number;
  height: number;
  options: Omit<EncodeOptions, "width" | "height" | "frames">;
}

export interface ParallelResult {
  gif: Uint8Array;
  index: number;
}

/**
 * Encode multiple GIFs in parallel using worker threads.
 *
 * Frame data is COPIED (not transferred) to workers so the caller
 * can reuse frame buffers across multiple jobs.
 *
 * @param jobs - Array of encode jobs
 * @param concurrency - Max simultaneous workers (defaults to CPU count)
 * @param onProgress - Optional callback for progress reporting
 * @returns Array of GIF byte arrays, one per job
 */
export async function encodeParallel(
  jobs: EncodeJob[],
  concurrency: number = cpus().length,
  onProgress?: (completed: number, total: number, index: number) => void,
): Promise<Uint8Array[]> {
  if (jobs.length === 0) return [];

  const results = new Array<Uint8Array>(jobs.length);
  let nextIdx = 0;
  let completed = 0;

  const isTsx = !!(
    process.env.TSX_TSCONFIG_PATH ||
    process.execArgv.some((a: string) => a.includes("tsx"))
  );
  const execArgv = isTsx ? ["--import", "tsx"] : [];

  return new Promise((resolve, reject) => {
    let rejected = false;

    function startNext() {
      if (rejected || nextIdx >= jobs.length) return;

      const jobIndex = nextIdx++;
      const job = jobs[jobIndex];

      const frameBuffers = job.frames.map((f) =>
        f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength),
      );

      const worker = new Worker(WORKER_PATH, {
        workerData: {
          frameBuffers,
          width: job.width,
          height: job.height,
          delay: job.frames[0]?.delay ?? 50,
          options: job.options,
        },
        transferList: frameBuffers,
        execArgv,
      });

      worker.on("message", (msg: { gif?: ArrayBuffer; error?: string }) => {
        if (msg.error) {
          rejected = true;
          reject(new Error(`Worker ${jobIndex}: ${msg.error}`));
          return;
        }
        results[jobIndex] = new Uint8Array(msg.gif!);
        completed++;
        onProgress?.(completed, jobs.length, jobIndex);

        if (completed === jobs.length) {
          resolve(results);
        } else {
          startNext();
        }
      });

      worker.on("error", (err: Error) => {
        if (!rejected) {
          rejected = true;
          reject(err);
        }
      });
    }

    const initial = Math.min(concurrency, jobs.length);
    for (let i = 0; i < initial; i++) {
      startNext();
    }
  });
}
