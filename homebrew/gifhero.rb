# Homebrew formula for gifhero
#
# To use: create a GitHub repo called "homebrew-tap", copy this file
# into Formula/gifhero.rb, then update the version, URLs, and SHA256
# hashes after each release.
#
# Users install with: brew install <your-github-user>/tap/gifhero
#
# After tagging a release (git tag v1.0.0 && git push --tags), the
# GitHub Actions workflow builds binaries and uploads them as release
# assets. Update the URLs and hashes below with the new release values.
#
# To get SHA256 hashes:
#   curl -sL <url> | shasum -a 256

class Gifhero < Formula
  desc "High-compression GIF encoder — smaller files than gifski with better VMAF"
  homepage "https://github.com/Gabe-LS/gifhero"
  version "1.0.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-aarch64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER_SHA256_ARM64"
    else
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-x86_64-apple-darwin.tar.gz"
      sha256 "PLACEHOLDER_SHA256_X86_64"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-aarch64-unknown-linux-gnu.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_ARM64"
    else
      url "https://github.com/Gabe-LS/gifhero/releases/download/v#{version}/gifhero-x86_64-unknown-linux-gnu.tar.gz"
      sha256 "PLACEHOLDER_SHA256_LINUX_X86_64"
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
