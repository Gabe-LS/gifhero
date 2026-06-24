pub fn denoise_frames(
    frames: &mut [Vec<u8>],
    width: usize,
    height: usize,
    threshold: u8,
) {
    if frames.len() < 3 {
        return;
    }

    let num_pixels = width * height;
    let thresh = threshold as i16;

    for f in 2..frames.len() {
        let mut out = frames[f].clone();

        for i in 0..num_pixels {
            let si = i * 4;

            let mut max_dev: i16 = 0;
            for c in 0..3 {
                let a = frames[f][si + c] as i16;
                let b = frames[f - 1][si + c] as i16;
                let d = frames[f - 2][si + c] as i16;
                let dev = (a - b).abs().max((a - d).abs()).max((b - d).abs());
                if dev > max_dev {
                    max_dev = dev;
                }
            }

            if max_dev > 0 && max_dev <= thresh {
                for c in 0..3 {
                    let a = frames[f][si + c];
                    let b = frames[f - 1][si + c];
                    let d = frames[f - 2][si + c];
                    let med = median3(a, b, d);
                    out[si + c] = med;
                }
            }
        }

        frames[f] = out;
    }
}

#[inline]
fn median3(a: u8, b: u8, d: u8) -> u8 {
    if a > b {
        if b > d { b } else if a > d { d } else { a }
    } else if a > d {
        a
    } else if b > d {
        d
    } else {
        b
    }
}
