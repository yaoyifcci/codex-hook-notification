#!/bin/sh
set -eu
mkdir -p dist
for arch in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags='-s -w' -o "dist/codex-hook-linux-$arch" ./cmd/codex-hook
done
