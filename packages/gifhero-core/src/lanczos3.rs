use std::f64::consts::PI;

fn sinc(x: f64) -> f64 {
    if x == 0.0 { return 1.0; }
    let px = PI * x;
    px.sin() / px
}

fn lanczos3_weight(x: f64) -> f64 {
    let x = x.abs();
    if x >= 3.0 { return 0.0; }
    sinc(x) * sinc(x / 3.0)
}

struct KernelEntry {
    start: usize,
    weights: Vec<f32>,
}

fn precompute_kernel(dst_size: usize, src_size: usize) -> Vec<KernelEntry> {
    let scale = (src_size as f64) / (dst_size as f64);
    let support = (3.0 * scale).ceil() as isize;
    let mut entries = Vec::with_capacity(dst_size);

    for i in 0..dst_size {
        let center = (i as f64 + 0.5) * scale - 0.5;
        let k_min = 0isize.max((center - support as f64).floor() as isize) as usize;
        let k_max = (src_size - 1).min((center + support as f64).ceil() as usize);

        let mut weights = Vec::with_capacity(k_max - k_min + 1);
        for k in k_min..=k_max {
            weights.push(lanczos3_weight((k as f64 - center) / scale) as f32);
        }

        entries.push(KernelEntry { start: k_min, weights });
    }

    entries
}

pub fn downsample_lanczos3(
    src: &[u8],
    src_w: usize,
    src_h: usize,
    dst_w: usize,
    dst_h: usize,
) -> Vec<u8> {
    if dst_w >= src_w && dst_h >= src_h {
        return src.to_vec();
    }

    let x_kernel = precompute_kernel(dst_w, src_w);
    let y_kernel = precompute_kernel(dst_h, src_h);

    let mut tmp = vec![0.0f32; dst_w * src_h * 4];

    for y in 0..src_h {
        let row_offset = y * src_w * 4;
        let dst_row = y * dst_w * 4;
        for (x, ke) in x_kernel.iter().enumerate() {
            let mut r = 0.0f32;
            let mut g = 0.0f32;
            let mut b = 0.0f32;
            let mut a = 0.0f32;
            let mut w_sum = 0.0f32;

            for (j, &w) in ke.weights.iter().enumerate() {
                let si = row_offset + (ke.start + j) * 4;
                let sa = src[si + 3] as f32 * (1.0 / 255.0);
                r += src[si] as f32 * sa * w;
                g += src[si + 1] as f32 * sa * w;
                b += src[si + 2] as f32 * sa * w;
                a += sa * w;
                w_sum += w;
            }

            let di = dst_row + x * 4;
            if a > 0.001 {
                let inv_a = 1.0 / a;
                tmp[di] = r * inv_a;
                tmp[di + 1] = g * inv_a;
                tmp[di + 2] = b * inv_a;
                tmp[di + 3] = a / w_sum * 255.0;
            }
        }
    }

    let mut dst = vec![0u8; dst_w * dst_h * 4];
    let stride = dst_w * 4;

    for y in 0..dst_h {
        let ke = &y_kernel[y];
        let dst_row = y * stride;
        for x in 0..dst_w {
            let x4 = x * 4;
            let mut r = 0.0f32;
            let mut g = 0.0f32;
            let mut b = 0.0f32;
            let mut a = 0.0f32;
            let mut w_sum = 0.0f32;

            for (j, &w) in ke.weights.iter().enumerate() {
                let si = (ke.start + j) * stride + x4;
                let sa = tmp[si + 3] * (1.0 / 255.0);
                r += tmp[si] * sa * w;
                g += tmp[si + 1] * sa * w;
                b += tmp[si + 2] * sa * w;
                a += sa * w;
                w_sum += w;
            }

            let di = dst_row + x4;
            if a > 0.001 {
                let inv_a = 1.0 / a;
                dst[di] = (r * inv_a + 0.5).clamp(0.0, 255.0) as u8;
                dst[di + 1] = (g * inv_a + 0.5).clamp(0.0, 255.0) as u8;
                dst[di + 2] = (b * inv_a + 0.5).clamp(0.0, 255.0) as u8;
                dst[di + 3] = (a / w_sum * 255.0 + 0.5).clamp(0.0, 255.0) as u8;
            }
        }
    }

    dst
}
