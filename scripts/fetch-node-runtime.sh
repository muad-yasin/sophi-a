#!/usr/bin/env bash
# Fetches the pinned Node runtime Sophi-A bundles for the orchestrator sidecar
# (PLAN_PACKAGING.md §2.1: "a pinned Node 22 LTS static build, fetched and verified by SHA-256 at
# packaging time"). Not committed to the repo - a ~50-100MB binary per platform doesn't belong in
# git history; this script re-fetches and re-verifies it on demand, locally or in CI.
#
# Usage: scripts/fetch-node-runtime.sh <linux-x64|win-x64>
# Output: dist-node/<target>/node (linux) or dist-node/<target>/node.exe (win), plus the license.
#
# To bump the pinned version: update NODE_VERSION and the two hashes below from
# https://nodejs.org/dist/vX.Y.Z/SHASUMS256.txt - never trust a freshly-downloaded checksum file
# at fetch time, that defeats the point of pinning.
set -euo pipefail

NODE_VERSION="22.23.2"
LINUX_X64_SHA256="d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307"
WIN_X64_SHA256="1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97"

target="${1:?usage: fetch-node-runtime.sh <linux-x64|win-x64>}"
out_dir="dist-node/${target}"
rm -rf "$out_dir"
mkdir -p "$out_dir"

case "$target" in
  linux-x64)
    archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
    expected_sha256="$LINUX_X64_SHA256"
    ;;
  win-x64)
    archive="node-v${NODE_VERSION}-win-x64.zip"
    expected_sha256="$WIN_X64_SHA256"
    ;;
  *)
    echo "unknown target: $target (expected linux-x64 or win-x64)" >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" -o "$tmp/$archive"

actual_sha256="$(sha256sum "$tmp/$archive" | cut -d' ' -f1)"
if [ "$actual_sha256" != "$expected_sha256" ]; then
  echo "SHA-256 mismatch for $archive: expected $expected_sha256, got $actual_sha256" >&2
  exit 1
fi

case "$target" in
  linux-x64)
    tar -xJf "$tmp/$archive" -C "$tmp"
    extracted="$tmp/node-v${NODE_VERSION}-linux-x64"
    cp "$extracted/bin/node" "$out_dir/node"
    cp "$extracted/LICENSE" "$out_dir/LICENSE"
    chmod +x "$out_dir/node"
    ;;
  win-x64)
    unzip -q "$tmp/$archive" -d "$tmp"
    extracted="$tmp/node-v${NODE_VERSION}-win-x64"
    cp "$extracted/node.exe" "$out_dir/node.exe"
    cp "$extracted/LICENSE" "$out_dir/LICENSE"
    ;;
esac

echo "Verified and extracted Node ${NODE_VERSION} (${target}) into ${out_dir}"
