// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { CallSummary } from '@signalapp/ringrtc';
// Observer Vault: DAY and MINUTE unused (survey disabled)
// import { DAY, MINUTE } from './durations/index.std.js';
import { isFeaturedEnabledNoRedux } from './isFeatureEnabled.dom.js';
// Observer Vault: isMockEnvironment unused (survey disabled)
// import { isMockEnvironment } from '../environment.std.js';
// Observer Vault: RemoteConfig imports unused (survey disabled)
// import {
//   COUNTRY_CODE_FALLBACK,
//   getCountryCodeValue,
//   getValue,
// } from '../RemoteConfig.dom.js';
// import { getCountryCode } from '../types/PhoneNumber.std.js';
// import { createLogger } from '../logging/log.std.js';

// Observer Vault: log unused (survey disabled)
// const log = createLogger('callQualitySurvey');

const FAILURE_END_REASONS: ReadonlySet<string> = new Set([
  'internalFailure',
  'signalingFailure',
  'connectionFailure',
  'iceFailedAfterConnected',
]);

// Observer Vault: Survey disabled, SURVEY_COOLDOWN, SHORT_CALL_THRESHOLD,
// LONG_CALL_THRESHOLD, and DEFAULT_PPM constants are intentionally not defined

export function isCallFailure(callEndReasonText: string): boolean {
  return FAILURE_END_REASONS.has(callEndReasonText);
}

export function isCallQualitySurveyEnabled(): boolean {
  return isFeaturedEnabledNoRedux({
    betaKey: 'desktop.callQualitySurvey.beta',
    prodKey: 'desktop.callQualitySurvey.prod',
  });
}

export function shouldShowCallQualitySurvey(
  // Observer Vault: Disable call quality survey entirely, all params unused
  _params: {
    callSummary: CallSummary;
    lastSurveyTime: number | null;
    lastFailureSurveyTime: number | null;
    e164: string | undefined;
    bypassCooldown?: boolean;
  }
): boolean {
  // Observer Vault: Disable call quality survey entirely
  return false;
}

// Observer Vault: Survey disabled, _getCallQualitySurveyPPM function removed
