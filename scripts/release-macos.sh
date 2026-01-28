#!/bin/bash
# Copyright 2025 Lockdown Systems LLC
# SPDX-License-Identifier: AGPL-3.0-only
#
# macOS Release Build Script for Observer Vault
#
# This script builds a signed and notarized macOS release.
#
# Prerequisites:
#   - Developer ID Application certificate installed in Keychain
#   - Environment variables set (see below)
#
# Environment Variables:
#   APPLE_USERNAME     - Apple ID email for notarization
#   APPLE_PASSWORD     - App-specific password for notarization
#   APPLE_TEAM_ID      - Apple Developer Team ID (defaults to G762K6CH36)
#
# Usage:
#   ./scripts/release-macos.sh [--no-sign] [--no-notarize]
#
# Options:
#   --no-sign       Skip code signing (for local testing)
#   --no-notarize   Skip notarization (sign only)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
TEAM_ID="${APPLE_TEAM_ID:-G762K6CH36}"
IDENTITY="Developer ID Application: Lockdown Systems LLC ($TEAM_ID)"
SKIP_SIGN=false
SKIP_NOTARIZE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-sign)
            SKIP_SIGN=true
            SKIP_NOTARIZE=true
            shift
            ;;
        --no-notarize)
            SKIP_NOTARIZE=true
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
echo "Observer Vault macOS Release Build"
echo "=========================================="
echo ""

# Check for required tools
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed"
    exit 1
fi

if ! command -v codesign &> /dev/null; then
    echo "Error: codesign is not available (Xcode Command Line Tools required)"
    exit 1
fi

# Check for signing certificate if signing is enabled
if [ "$SKIP_SIGN" = false ]; then
    if ! security find-identity -v -p codesigning | grep -q "$TEAM_ID"; then
        echo "Error: No Developer ID Application certificate found for team $TEAM_ID"
        echo "Install your certificate or use --no-sign for local testing"
        exit 1
    fi
    echo "✓ Found signing certificate: $IDENTITY"
fi

# Check notarization credentials if notarizing
if [ "$SKIP_NOTARIZE" = false ]; then
    if [ -z "${APPLE_USERNAME:-}" ]; then
        echo "Error: APPLE_USERNAME environment variable is required for notarization"
        echo "Set it to your Apple ID email, or use --no-notarize to skip"
        exit 1
    fi
    if [ -z "${APPLE_PASSWORD:-}" ]; then
        echo "Error: APPLE_PASSWORD environment variable is required for notarization"
        echo "Generate an app-specific password at https://appleid.apple.com/account/manage"
        echo "Or use --no-notarize to skip"
        exit 1
    fi
    echo "✓ Notarization credentials configured (Apple ID: $APPLE_USERNAME)"
fi

# Create the signing script that electron-builder will use
SIGN_SCRIPT="$PROJECT_ROOT/.tmp-sign-macos.sh"
cat > "$SIGN_SCRIPT" << 'SIGN_EOF'
#!/bin/bash
set -euo pipefail

APP_PATH="$1"
TEAM_ID="${APPLE_TEAM_ID:-G762K6CH36}"
IDENTITY="Developer ID Application: Lockdown Systems LLC ($TEAM_ID)"
ENTITLEMENTS_MAIN="build/entitlements.mac.plist"
ENTITLEMENTS_INHERIT="build/entitlements.mac.inherit.plist"

echo "Signing: $APP_PATH"

# Sign native node modules in app.asar.unpacked first (required for notarization)
UNPACKED_DIR="$APP_PATH/Contents/Resources/app.asar.unpacked"
if [ -d "$UNPACKED_DIR" ]; then
    echo "Signing native modules in app.asar.unpacked..."
    
    # Sign all .node files (native modules)
    find "$UNPACKED_DIR" -type f -name "*.node" | while read -r file; do
        echo "  Signing: $(basename "$file")"
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS_INHERIT" \
            --sign "$IDENTITY" \
            "$file"
    done
    
    # Sign all .dylib files
    find "$UNPACKED_DIR" -type f -name "*.dylib" | while read -r file; do
        echo "  Signing: $(basename "$file")"
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS_INHERIT" \
            --sign "$IDENTITY" \
            "$file"
    done
    
    # Sign any executable binaries (no extension, but executable)
    find "$UNPACKED_DIR" -type f -perm +111 ! -name "*.node" ! -name "*.dylib" ! -name "*.js" ! -name "*.json" ! -name "*.txt" ! -name "*.md" | while read -r file; do
        # Check if it's a Mach-O binary
        if file "$file" | grep -q "Mach-O"; then
            echo "  Signing: $(basename "$file")"
            codesign --force --options runtime --timestamp \
                --entitlements "$ENTITLEMENTS_INHERIT" \
                --sign "$IDENTITY" \
                "$file"
        fi
    done
fi

# Sign frameworks
if [ -d "$APP_PATH/Contents/Frameworks" ]; then
    echo "Signing frameworks..."
    
    # Sign all executables and dylibs inside frameworks
    find "$APP_PATH/Contents/Frameworks" -type f \( -perm +111 -o -name "*.dylib" \) | while read -r file; do
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS_INHERIT" \
            --sign "$IDENTITY" \
            "$file" 2>/dev/null || true
    done

    # Sign framework bundles
    find "$APP_PATH/Contents/Frameworks" -type d -name "*.framework" | while read -r framework; do
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS_INHERIT" \
            --sign "$IDENTITY" \
            "$framework" 2>/dev/null || true
    done

    # Sign helper apps
    find "$APP_PATH/Contents/Frameworks" -type d -name "*.app" | while read -r helper; do
        codesign --force --options runtime --timestamp \
            --entitlements "$ENTITLEMENTS_INHERIT" \
            --sign "$IDENTITY" \
            "$helper" 2>/dev/null || true
    done
fi

# Sign the main app
echo "Signing main app bundle..."
codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS_MAIN" \
    --sign "$IDENTITY" \
    "$APP_PATH"

echo "Signing complete: $APP_PATH"
SIGN_EOF
chmod +x "$SIGN_SCRIPT"

# Set up environment for build
export APPLE_TEAM_ID="$TEAM_ID"

if [ "$SKIP_SIGN" = true ]; then
    # Create a no-op signing script
    echo '#!/bin/bash' > "$SIGN_SCRIPT"
    echo 'echo "Skipping signing for: $1"' >> "$SIGN_SCRIPT"
    chmod +x "$SIGN_SCRIPT"
    echo "⚠ Signing disabled"
fi

if [ "$SKIP_NOTARIZE" = true ]; then
    unset APPLE_USERNAME
    unset APPLE_PASSWORD
    echo "⚠ Notarization disabled"
fi

export SIGN_MACOS_SCRIPT="$SIGN_SCRIPT"

echo ""
echo "Step 1: Installing dependencies..."
pnpm install

echo ""
echo "Step 2: Generating assets..."
pnpm run generate

echo ""
echo "Step 3: Building release..."
pnpm run build

# Clean up
rm -f "$SIGN_SCRIPT"

echo ""
echo "=========================================="
echo "Build Complete!"
echo "=========================================="
echo ""
echo "Release artifacts in: $PROJECT_ROOT/release/"
ls -la "$PROJECT_ROOT/release/"*.{zip,dmg} 2>/dev/null || echo "(no artifacts found)"

# Ad-hoc sign if we skipped signing
if [ "$SKIP_SIGN" = true ]; then
    echo ""
    echo "To run locally, ad-hoc sign the app:"
    echo "  cd release/mac-arm64 && codesign --force --deep --sign - 'Observer Vault.app'"
fi
