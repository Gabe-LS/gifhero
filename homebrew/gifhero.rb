class Gifhero < Formula
  desc "High-compression GIF encoder — smaller files than gifski with better VMAF"
  homepage "https://github.com/Gabe-LS/gifhero"
  version "1.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-aarch64-apple-darwin.tar.gz"
      sha256 "924a9bee2f451b5191b68bfc60183208c2fff1bc55a1cef8ff16a4f14fffdd29"
    else
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-x86_64-apple-darwin.tar.gz"
      sha256 "cb2e9afd5c9aa546fddb1b1eba776af63138c743b899808c23cad23c7b2c8999"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "2f2c454229292528efbbf3a560df8743af78fc163808499e803bb84214855854"
    else
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "dc2237ab095bca2f5e869700c503a08bb07839775dfcea9e7d9d0132541f98ca"
    end
  end

  depends_on "ffmpeg"

  def install
    bin.install "gifhero"
  end

  test do
    assert_match "gifhero", shell_output("#{bin}/gifhero --help")
  end
end
