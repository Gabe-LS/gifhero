/**
 * Minimal Node.js type declarations for modules used by the
 * imagequant WASM loader. These allow compilation without
 * @types/node installed; replace with the full package when available.
 */

declare module "fs" {
  function readFileSync(path: string): Uint8Array;
}

declare module "path" {
  function join(...paths: string[]): string;
  function dirname(path: string): string;
}

declare module "module" {
  function createRequire(
    url: string | URL,
  ): ((id: string) => any) & { resolve(id: string): string };
}

declare module "zlib" {
  function inflateSync(buf: Uint8Array): Uint8Array;
}
