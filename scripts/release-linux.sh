#!/bin/bash
# Copyright 2025 Lockdown Systems LLC
# SPDX-License-Identifier: AGPL-3.0-only
#
# Linux Release Build Script for Observer Vault
#
# This script builds a Linux .deb package.
#
# Prerequisites:
#   - gcc, g++, make
#   - Python 3.6+
#   - Node.js (version from .nvmrc)
#   - pnpm
#
# Usage:
#   ./scripts/release-linux.sh [--reproducible]
#
# Options:
#   --reproducible    Use Docker for reproducible builds

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REPRODUCIBLE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --reproducible)
            REPRODUCIBLE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

cd "$PROJECT_ROOT"

echo "=========================================="
echo "Observer Vault Linux Release Build"
echo "=========================================="
echo ""

if [ "$REPRODUCIBLE" = true ]; then
    echo "Using reproducible Docker build..."
    echo ""
    
    if ! command -v docker &> /dev/null; then
        echo "Error: docker is not installed"
        echo "Install Docker to use reproducible builds"
        exit 1
    fi
    
    cd "$PROJECT_ROOT/reproducible-builds"
    ./build.sh public
    
    echo ""
    echo "=========================================="
    echo "Reproducible Build Complete!"
    echo "=========================================="
    echo ""
    echo "Release artifacts in: $PROJECT_ROOT/release/"
    ls -la "$PROJECT_ROOT/release/"*.deb 2>/dev/null || echo "(no artifacts found)"
    exit 0
fi

# Regular build
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed"
    exit 1
fi

if ! command -v gcc &> /dev/null; then
    echo "Error: gcc is not installed"
    exit 1
fi

if ! command -v g++ &> /dev/null; then
    echo "Error: g++ is not installed"
    exit 1
fi

echo "✓ Build tools found"
echo ""

echo "Step 1: Installing dependencies..."
pnpm install

echo ""
echo "Step 2: Generating assets..."
pnpm run generate

echo ""
echo "Step 3: Building release..."
pnpm run build-linux

echo ""
echo "=========================================="
echo "Build Complete!"
echo "=========================================="
echo ""
echo "Release artifacts in: $PROJECT_ROOT/release/"
ls -la "$PROJECT_ROOT/release/"*.deb 2>/dev/null || echo "(no artifacts found)"

# Print installation instructions
echo ""
echo "To install the .deb package:"
echo "  sudo dpkg -i release/observer-vault_*.deb"
echo "  sudo apt-get install -f  # Install any missing dependencies"
