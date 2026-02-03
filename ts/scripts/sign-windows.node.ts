// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

// Copyright 2026 Lockdown Systems LLC

import { execSync } from 'node:child_process';

import fsExtra from 'fs-extra';

import type { CustomWindowsSignTaskConfiguration } from 'electron-builder';

const { realpath } = fsExtra;

export async function sign(
  configuration: CustomWindowsSignTaskConfiguration
): Promise<void> {
  // In CI, we remove certificate information from package.json to disable signing
  if (
    !configuration.options.signtoolOptions ||
    !configuration.options.signtoolOptions.certificateSha1
  ) {
    return;
  }

  const scriptPath = process.env.SIGN_WINDOWS_SCRIPT;
  if (!scriptPath) {
    throw new Error(
      'path to windows sign script must be provided in environment variable SIGN_WINDOWS_SCRIPT'
    );
  }

  const target = await realpath(configuration.path);

  // Use appropriate shell based on script extension
  let command: string;
  if (scriptPath.endsWith('.ps1')) {
    command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" "${target}"`;
  } else if (scriptPath.endsWith('.cmd') || scriptPath.endsWith('.bat')) {
    command = `"${scriptPath}" "${target}"`;
  } else {
    // Default to bash for .sh scripts
    command = `bash "${scriptPath}" "${target}"`;
  }

  // The script will update the file in-place
  const returnCode = execSync(command, {
    stdio: [null, process.stdout, process.stderr],
  });

  if (returnCode) {
    throw new Error(`sign-windows: Script returned code ${returnCode}`);
  }
}
