// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

// Observer Vault: Microphone is never used, always return true to not block call flow
export async function requestMicrophonePermissions(
  _forCalling: boolean
): Promise<boolean> {
  return true;
}
