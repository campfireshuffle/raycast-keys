#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
# Both slices use the same minimum deployment target; no credentials are needed.
for name in KeySender MutationLock; do
  case "$name" in
    KeySender) output=key-sender; set -- -framework AppKit -framework Carbon ;;
    MutationLock) output=mutation-lock; set -- ;;
  esac
  for arch in arm64 x86_64; do
    xcrun swiftc -target "$arch-apple-macosx12.0" "native/$name.swift" -o "$scratch/$output-$arch" "$@"
  done
  xcrun lipo -create "$scratch/$output-arm64" "$scratch/$output-x86_64" -output "$scratch/$output"
  codesign --force --sign - --identifier "com.sabbas.raycast.physical-key-macros.$output" "$scratch/$output"
  codesign --verify --strict "$scratch/$output"
  slices=$(xcrun lipo -archs "$scratch/$output")
  [[ " $slices " == *" arm64 "* && " $slices " == *" x86_64 "* ]]
  # Install only after both slices and the signature have been checked.
  install -m 755 "$scratch/$output" "assets/$output"
done
