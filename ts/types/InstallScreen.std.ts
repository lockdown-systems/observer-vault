// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

export enum InstallScreenStep {
  NotStarted = 'NotStarted',

  // Registration flow (primary device)
  PhoneNumberEntry = 'PhoneNumberEntry',
  CaptchaChallenge = 'CaptchaChallenge',
  VerificationCodeEntry = 'VerificationCodeEntry',
  CreatingAccount = 'CreatingAccount',
  ProfileNameEntry = 'ProfileNameEntry',

  // Legacy - kept for compatibility with existing components
  QrCodeNotScanned = 'QrCodeNotScanned',
  LinkInProgress = 'LinkInProgress',

  // Backup import (kept for compatibility)
  BackupImport = 'BackupImport',

  Error = 'Error',
}

export enum InstallScreenBackupStep {
  WaitForBackup = 'WaitForBackup',
  Download = 'Download',
  Process = 'Process',
}

export enum InstallScreenBackupError {
  UnsupportedVersion = 'UnsupportedVersion',
  Retriable = 'Retriable',
  Fatal = 'Fatal',
  Canceled = 'Canceled',
}

export enum InstallScreenError {
  ConnectionFailed = 'ConnectionFailed',
  InvalidPhoneNumber = 'InvalidPhoneNumber',
  CaptchaFailed = 'CaptchaFailed',
  VerificationCodeExpired = 'VerificationCodeExpired',
  VerificationCodeIncorrect = 'VerificationCodeIncorrect',
  RateLimited = 'RateLimited',
  RegistrationFailed = 'RegistrationFailed',
  // Legacy errors (kept for compatibility)
  TooManyDevices = 'TooManyDevices',
  TooOld = 'TooOld',
  QRCodeFailed = 'QRCodeFailed',
}

export enum InstallScreenQRCodeError {
  MaxRotations = 'MaxRotations',
  Timeout = 'Timeout',
  Unknown = 'Unknown',
  NetworkIssue = 'NetworkIssue',
}

// This is the string's `.length`, which is the number of UTF-16 code points. Instead, we
//   want this to be either 50 graphemes or 256 encrypted bytes, whichever is smaller. See
//   DESKTOP-2844.
export const MAX_DEVICE_NAME_LENGTH = 50;
