# Copyright 2026 Lockdown Systems LLC
# SPDX-License-Identifier: AGPL-3.0-only
#
# Windows Release Build Script for Observer Vault
#
# This script builds a Windows release with code signing using a smartcard.
#
# Prerequisites:
#   - Visual Studio 2022 Build Tools with "Desktop development with C++"
#   - Windows SDK (includes signtool.exe)
#   - Python 3.6+
#   - Node.js (version from .nvmrc)
#   - pnpm
#   - Code signing certificate on smartcard (for signed releases)
#
# Usage:
#   .\scripts\release-windows.ps1 [-NoSign] [-Arch <x64|arm64|all>]
#
# Options:
#   -NoSign     Skip code signing (builds unsigned)
#   -Arch       Target architecture: x64, arm64, or all (default: all)
#
# Note: When signing is enabled, signtool will prompt for your smartcard PIN.

param(
    [switch]$NoSign,
    [ValidateSet("x64", "arm64", "all")]
    [string]$Arch = "all"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Find the latest signtool.exe path (same approach as Cyd)
function Find-LatestSigntoolPath {
    $baseDir = "C:\Program Files (x86)\Windows Kits\10\bin"
    $versionPrefix = "10."

    try {
        # Read the directories in the base directory
        $directories = Get-ChildItem -Path $baseDir -Directory -ErrorAction Stop |
            Where-Object { $_.Name.StartsWith($versionPrefix) } |
            Sort-Object { $_.Name } -Descending

        if ($directories.Count -eq 0) {
            throw "No Windows SDK version directories found in $baseDir"
        }

        # Get the largest version directory
        $latestVersionDir = $directories[0].Name

        # Construct the path to signtool.exe (Join-Path only takes 2 args at a time)
        $signtoolPath = Join-Path $baseDir $latestVersionDir
        $signtoolPath = Join-Path $signtoolPath "x64"
        $signtoolPath = Join-Path $signtoolPath "signtool.exe"

        # Check if signtool.exe exists
        if (-not (Test-Path $signtoolPath)) {
            throw "signtool.exe not found at $signtoolPath"
        }

        return $signtoolPath
    } catch {
        Write-Host "Error finding signtool.exe: $_" -ForegroundColor Red
        return $null
    }
}

Push-Location $ProjectRoot

try {
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "Observer Vault Windows Release Build" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""

    # Check for required tools
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "pnpm is not installed. Install it with: npm install -g pnpm"
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js is not installed"
    }

    # Set up signing if enabled (uses smartcard, same as Cyd)
    $SigntoolPath = $null
    if (-not $NoSign) {
        $SigntoolPath = Find-LatestSigntoolPath
        if ($SigntoolPath) {
            Write-Host "[OK] Found signtool: $SigntoolPath" -ForegroundColor Green
            Write-Host "     Signing will use smartcard - you will be prompted for PIN" -ForegroundColor Yellow
            
            # Create signing script that uses smartcard (no certificate file needed)
            # Uses /a flag to auto-select best signing cert from store
            $SignScript = Join-Path $ProjectRoot ".tmp-sign-windows.sh"
            $SigntoolPathEscaped = $SigntoolPath -replace '\\', '/'
            $SignScriptContent = @"
#!/bin/bash
# Smartcard signing script for Observer Vault
# signtool will prompt for smartcard PIN

FILE_PATH="`$1"

"$SigntoolPathEscaped" sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a "`$FILE_PATH"
"@
            $SignScriptContent | Out-File -FilePath $SignScript -Encoding ASCII -NoNewline
            
            $env:SIGN_WINDOWS_SCRIPT = $SignScript
        } else {
            Write-Host "[WARNING] signtool.exe not found. Building unsigned." -ForegroundColor Yellow
            Write-Host "          Install Windows SDK to enable signing" -ForegroundColor Yellow
            $NoSign = $true
        }
    } else {
        Write-Host "[WARNING] Signing disabled" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "Step 1: Installing dependencies..." -ForegroundColor Cyan
    pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

    Write-Host ""
    Write-Host "Step 2: Generating assets..." -ForegroundColor Cyan
    pnpm run generate
    if ($LASTEXITCODE -ne 0) { throw "pnpm run generate failed" }

    Write-Host ""
    Write-Host "Step 3: Building release..." -ForegroundColor Cyan
    
    if ($Arch -eq "all") {
        pnpm run build-win32-all
    } else {
        $env:npm_config_arch = $Arch
        pnpm run build
    }
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }

    # Clean up temp files
    $SignScript = Join-Path $ProjectRoot ".tmp-sign-windows.sh"
    if (Test-Path $SignScript) {
        Remove-Item $SignScript -Force
    }

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host "Build Complete!" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Release artifacts in: $ProjectRoot\release\" -ForegroundColor White
    Get-ChildItem "$ProjectRoot\release\*.exe" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }

    if ($NoSign) {
        Write-Host ""
        Write-Host "[WARNING] Note: The installer is unsigned. Windows SmartScreen may show warnings." -ForegroundColor Yellow
    }

} finally {
    Pop-Location
}
