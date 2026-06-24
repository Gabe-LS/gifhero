use gifhero_core::lzw::{lzw_encode, lzw_encode_lossy};

fn to_hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

#[test]
fn crossval_solid_4x4_idx0() {
    let pixels = vec![0u8; 16];
    let encoded = lzw_encode(&pixels, 2);
    let hex = to_hex(&encoded);
    assert_eq!(hex, "848f0905", "solid-4x4-idx0");
}

#[test]
fn crossval_alternating_4colors() {
    let pixels: Vec<u8> = vec![0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
    let encoded = lzw_encode(&pixels, 2);
    let hex = to_hex(&encoded);
    assert_eq!(hex, "4434869a3705", "alternating-4colors");
}

#[test]
fn crossval_gradient_256() {
    let pixels: Vec<u8> = (0..=255).collect();
    let encoded = lzw_encode(&pixels, 8);
    let expected = "00010410308040010307102450b0804103070f204490308142050b173064d0b08143070f1f40841031824409132750a450b182450b172f60c4903183460d1b3770e4d0b183470f1f3f800411328448112347902451b2844913274fa0449132854a152b57b064d1b2854b172f5fc0841133864c193367d0a451b3864d1b376fe0c49133874e1d3b77f0e4d1b3874f1f3f7f000512348850214387102552b4885123478f204592348952254b973065d2b48953274f9f408512358a542953a750a552b58a552b57af60c592358b562d5bb770e5d2b58b572f5fbf800513368c583163c7902553b68c593367cfa04593368d5a356bd7b065d3b68d5b376fdfc08513378e5c3973e7d0a553b78e5d3b77efe0c593378f5e3d7bf7f0e5d3b78f5f3f7fff0404";
    let hex = to_hex(&encoded);
    assert_eq!(hex, expected, "gradient-256");
}

#[test]
fn crossval_repetitive_1000() {
    let pixels: Vec<u8> = (0..1000).map(|i| (i % 64) as u8).collect();
    let encoded = lzw_encode(&pixels, 7);
    let expected = "80000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f828486888a8c8e90929496989a9c9ea0a2a4a6a8aaacaeb0b2b4b6b8babcbec0c28587898b8d8f91939597999b9d9fa1a3a5a7a9abadafb1b3b5b7b9bbbdbfc1068d2b660e59ba65ec9cbd8b268f5abd6bf8b4edebe60f5cc061e48c9d4ba68e59bb67f0a4cdab660f5bbe6dfcbcfd0b279058b963e894ad6be60e5abc69f4acddcba68f5bbf6f00c5b9d46850a6478536453ad46952a24f951685662c18b363c29a211be62c19b167ca8a415b4e85c911214d900c719284c8132545a02c3112247b70e6c78537473edc7972e2cf951707bedc58f728d6b47a997675fb37aad8b9848d5e459b7729d7b67ea186953bb8a8d5b378956e65dbf729d8b8828956357b37a9d6b57c9d7e851b7828d5b276916655bbb7a9d7b780a542f6cc5a3762878100";
    let hex = to_hex(&encoded);
    assert_eq!(hex, expected, "repetitive-1000");
}

#[test]
fn crossval_large_repetitive_5000() {
    let pixels: Vec<u8> = (0..5000).map(|i| (i % 32) as u8).collect();
    let encoded = lzw_encode(&pixels, 5);
    let expected = "2010080351180792280bd3380f14491355591796691bd7791f11c98452b15c3019cd86d3f17c4061e9945ab55eb159ed96dbf57ec1d1b4684566975ce7372a26568f58e5b6e985868754e335a965769f60526e7a66727e6a76827965717d6975816d8b707c6874806c78649467737f6b77636f7b9d879099a2848d969f89929ba4868f98a1838c959e88919aa3858e97a08ab0beacbaa8b69cb2c0aebcaab8a6b4c2bdabb9a7b593b1bfadbba9b7a5b3c1afd3cfe0ccddc9dac6d7c3d4d0e1cddecadbc7d8c4d5d1e2cedfcbdcc8d9c5d6a4e993a74e60bc7401f31d04880f1e3a86efcefdbb17d19f3d77e62cb62bd7afde467ef4d89103b96edcbe792507226c28f122c790260926743811634791270b2a7c4831a3c791280df2b4095325449f3865b2d40854274d972485d67c997261cf9b315756fc997366cb8f41774e8d2a166ad8a7609d7e6dea9569d7a55c956e4daa1569d6a3588d5e2d6a9568d5a154a59a55eb56ae5dbd7e05a76d1bb76edebe81cb2e864b172f5fc064d1b2a57c77efdfb167d7be9ddb39b1e4cda41147d63cfa30e4cca20d3fc61cbab0e3cba00937b6fc7930e3ca9e15a3764d5b3770d3ac65e3f6cd59356cdbbc85b79e9dfb77e9d5b16ff79e9cfa75edddc14f4f5fce9d78f5e6de8d5f7f0e1e79f6e8e2956f1f4e9d79f7e2d69d7f3f8e1d7af8e4da49279f8001c6572080f021f8df7b0bfae79e83fdb517217fec51b8df7a17eaa79e86f9a5d7217ee88178df7923da679e89f59597227de4b138df782f0e6860820c3e286185186ee86188249ea8628b30124823843872c85908";
    let hex = to_hex(&encoded);
    assert_eq!(hex, expected, "large-repetitive-5000");
}

#[test]
fn crossval_lossy_zero() {
    let pixels: Vec<u8> = (0..100).map(|i| (i % 16) as u8).collect();
    let mut palette = vec![0u8; 16 * 4];
    for i in 0..16 {
        palette[i * 4] = (i * 16) as u8;
        palette[i * 4 + 1] = (i * 16) as u8;
        palette[i * 4 + 2] = (i * 16) as u8;
        palette[i * 4 + 3] = 255;
    }

    let encoded = lzw_encode_lossy(&pixels, 4, &palette, 16, 0, -1);
    let expected = "10043148310725b558738f445998c679a0585dd9d67de1b4962e1a8facf9a632d99e305504";
    let hex = to_hex(&encoded);
    assert_eq!(hex, expected, "lossy-zero should match lossless");
}

#[test]
fn crossval_lossy_20() {
    let pixels: Vec<u8> = (0..1000).map(|i| (i % 16) as u8).collect();
    let mut palette = vec![0u8; 16 * 4];
    for i in 0..16 {
        palette[i * 4] = (i * 16) as u8;
        palette[i * 4 + 1] = (i * 16) as u8;
        palette[i * 4 + 2] = (i * 16) as u8;
        palette[i * 4 + 3] = 255;
    }

    let encoded = lzw_encode_lossy(&pixels, 4, &palette, 16, 20, -1);
    let expected = "10043148310725b558738f445998c679a0585dd9d67de1b4962e1a8facf9a632d99e30954f6713e66ac1de11c8c3d198b7d96f171d229b5262d2392d2a9f5423d8cbd562ad5071779bbd5697e1effa0c27b7d372f37bcc46c7cb6e6a7a828179858078887f778b7e768e7d75917c74947b73978386898c8f929598849c90a09a8a9e96a28d9f99879d93a19baba9b2a8b1a7b0a6afa011";
    let hex = to_hex(&encoded);
    assert_eq!(hex, expected, "lossy-20");
}

#[test]
fn crossval_lossy_5() {
    let pixels: Vec<u8> = (0..500).map(|i| (i % 8) as u8).collect();
    let mut palette = vec![0u8; 16 * 4];
    for i in 0..16 {
        palette[i * 4] = (i * 16) as u8;
        palette[i * 4 + 1] = (i * 16) as u8;
        palette[i * 4 + 2] = (i * 16) as u8;
        palette[i * 4 + 3] = 255;
    }

    let encoded = lzw_encode_lossy(&pixels, 4, &palette, 16, 5, -1);
    let expected = "100431483147528b75bdd9f47522176ea067aa69d9a2247c8ef3eac6348bdbb25ebfb9db6f07e4057b429f32c9443a8f50a3b448255a87d8e5737ad546abd9e6b72be6ce22";
    let hex = to_hex(&encoded);
    assert_eq!(hex, expected, "lossy-5");
}
