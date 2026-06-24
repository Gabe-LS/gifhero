pub mod probe;
pub mod denoise;

mod quantize;
mod subframe;
mod lanczos3;
mod lzw;
mod gif;
mod dither;

#[cfg(feature = "wasm")]
mod wasm;
