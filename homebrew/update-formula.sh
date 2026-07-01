#!/bin/bash
# Update Homebrew formula SHA256 hashes after a release.
#
# Usage: ./homebrew/update-formula.sh v1.0.0
#
# Requires: curl, shasum, sed
# Run after GitHub Actions finishes building the release binaries.

set -euo pipefail

VERSION="${1:?Usage: $0 <version-tag>}"
REPO="Gabe-LS/gifhero"
FORMULA="homebrew/gifhero.rb"

echo "Updating formula for ${VERSION}..."

TARGETS=(
  "aarch64-apple-darwin:PLACEHOLDER_SHA256_ARM64"
  "x86_64-apple-darwin:PLACEHOLDER_SHA256_X86_64"
  "aarch64-unknown-linux-gnu:PLACEHOLDER_SHA256_LINUX_ARM64"
  "x86_64-unknown-linux-gnu:PLACEHOLDER_SHA256_LINUX_X86_64"
)

# Update version
VER_NUM="${VERSION#v}"
sed -i '' "s/version \".*\"/version \"${VER_NUM}\"/" "${FORMULA}"

for entry in "${TARGETS[@]}"; do
  TARGET="${entry%%:*}"
  PLACEHOLDER="${entry##*:}"
  URL="https://github.com/${REPO}/releases/download/${VERSION}/gifhero-${TARGET}.tar.gz"

  echo "  Fetching ${TARGET}..."
  SHA=$(curl -sL "${URL}" | shasum -a 256 | awk '{print $1}')

  if [ -z "${SHA}" ] || [ "${SHA}" = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]; then
    echo "    WARNING: empty or missing asset for ${TARGET}"
    continue
  fi

  # Replace either the placeholder or a previous hash
  sed -i '' "s|sha256 \".*\" # ${TARGET}|sha256 \"${SHA}\" # ${TARGET}|" "${FORMULA}" 2>/dev/null || \
  sed -i '' "s|sha256 \"${PLACEHOLDER}\"|sha256 \"${SHA}\" # ${TARGET}|" "${FORMULA}"

  echo "    ${SHA}"
done

echo "Done. Copy ${FORMULA} to your homebrew-tap repo's Formula/ directory."
