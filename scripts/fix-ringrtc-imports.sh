#!/usr/bin/env bash
# Copyright 2026 Lockdown Systems LLC
# SPDX-License-Identifier: AGPL-3.0-only
#
# Fix RingRTC imports after merge
#
# After accepting upstream changes, this script replaces @signalapp/ringrtc
# with @lockdown-systems/ringrtc in all TypeScript files.
#
set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "Fixing RingRTC imports..."
echo ""

# Find all files with @signalapp/ringrtc imports
files=$(grep -r -l "@signalapp/ringrtc" --include="*.ts" --include="*.tsx" ts/ 2>/dev/null || true)

if [[ -z "$files" ]]; then
    echo -e "${GREEN}No @signalapp/ringrtc imports found - nothing to fix${NC}"
    exit 0
fi

count=0
while IFS= read -r file; do
    if [[ -n "$file" ]]; then
        echo -e "${BLUE}Fixing:${NC} $file"
        sed -i 's/@signalapp\/ringrtc/@lockdown-systems\/ringrtc/g' "$file"
        ((count++))
    fi
done <<< "$files"

echo ""
echo -e "${GREEN}Fixed $count files${NC}"
echo ""
echo "Don't forget to run 'pnpm generate' to verify the build!"
