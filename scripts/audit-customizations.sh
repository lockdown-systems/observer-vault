#!/usr/bin/env bash
# Copyright 2026 Lockdown Systems LLC
# SPDX-License-Identifier: AGPL-3.0-only
#
# List all Observer Vault customizations
#
# This script identifies files that differ from upstream Signal-Desktop
# and helps track what needs manual attention during merges.
#
set -euo pipefail

BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "====================================="
echo "  Observer Vault Customization Audit"
echo "====================================="
echo ""

echo -e "${BLUE}Files importing @lockdown-systems/ringrtc:${NC}"
echo "(These use our RingRTC fork instead of @signalapp/ringrtc)"
echo ""
grep -r "@lockdown-systems/ringrtc" --include="*.ts" --include="*.tsx" ts/ 2>/dev/null | \
    grep -v "node_modules" | \
    cut -d: -f1 | \
    sort -u | \
    while read -r file; do
        echo "  $file"
    done
echo ""

echo -e "${BLUE}Observer Vault custom modules:${NC}"
echo ""
find ts/observervault -name "*.ts" 2>/dev/null | while read -r file; do
    echo "  $file"
done
echo ""

echo -e "${BLUE}Files with 'Observer Vault' or 'observer-vault' comments/strings:${NC}"
echo ""
grep -r -l "Observer Vault\|observer-vault" --include="*.ts" --include="*.tsx" ts/ 2>/dev/null | \
    grep -v "node_modules" | \
    sort -u | \
    while read -r file; do
        echo "  $file"
    done
echo ""

echo -e "${YELLOW}Summary:${NC}"
echo ""
echo "Key customizations to preserve during merges:"
echo "  1. @lockdown-systems/ringrtc imports (not @signalapp/ringrtc)"
echo "  2. ts/observervault/ directory (custom features)"
echo "  3. Disabled call quality survey in ts/util/callQualitySurvey.dom.ts"
echo "  4. Challenge handler in InstallScreen"
echo "  5. Branding in package.json"
echo ""
