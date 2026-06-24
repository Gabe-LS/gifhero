pub mod probe;
pub mod denoise;
pub mod lzw;
pub mod gif;

mod quantize;
mod subframe;
mod lanczos3;
mod dither;

#[cfg(feature = "wasm")]
mod wasm;
