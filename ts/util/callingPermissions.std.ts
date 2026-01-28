// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

// Observer Vault: Camera is never used, always return true to not block call flow
export async function requestCameraPermissions(): Promise<boolean> {
  return true;
}
