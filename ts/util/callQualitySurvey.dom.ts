// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { CallSummary } from '@signalapp/ringrtc';
import { DAY, MINUTE } from './durations/index.std.js';
import { isFeaturedEnabledNoRedux } from './isFeatureEnabled.dom.js';
import { isMockEnvironment } from '../environment.std.js';
import {
  COUNTRY_CODE_FALLBACK,
  getCountryCodeValue,
  getValue,
} from '../RemoteConfig.dom.js';
import { getCountryCode } from '../types/PhoneNumber.std.js';
import { createLogger } from '../logging/log.std.js';

const log = createLogger('callQualitySurvey');

const FAILURE_END_REASONS: ReadonlySet<string> = new Set([
  'internalFailure',
  'signalingFailure',
  'connectionFailure',
  'iceFailedAfterConnected',
]);

const SURVEY_COOLDOWN = DAY;
const SHORT_CALL_THRESHOLD = MINUTE;
const LONG_CALL_THRESHOLD = 25 * MINUTE;
const DEFAULT_PPM = 10000; // 1% default

export function isCallFailure(callEndReasonText: string): boolean {
  return FAILURE_END_REASONS.has(callEndReasonText);
}

export function isCallQualitySurveyEnabled(): boolean {
  return isFeaturedEnabledNoRedux({
    betaKey: 'desktop.callQualitySurvey.beta',
    prodKey: 'desktop.callQualitySurvey.prod',
  });
}

export function shouldShowCallQualitySurvey({
  callSummary,
  lastSurveyTime,
  lastFailureSurveyTime,
  e164,
  bypassCooldown,
}: {
  callSummary: CallSummary;
  lastSurveyTime: number | null;
  lastFailureSurveyTime: number | null;
  e164: string | undefined;
  bypassCooldown?: boolean;
}): boolean {
  // Observer Vault: Disable call quality survey entirely
  return false;
}

function getCallQualitySurveyPPM(e164: string | undefined): number {
  const configValue = getValue('desktop.callQualitySurveyPPM');
  if (typeof configValue !== 'string') {
    return DEFAULT_PPM;
  }

  const countryCode = e164 != null ? getCountryCode(e164) : null;
  const ppm = getCountryCodeValue(
    countryCode ?? COUNTRY_CODE_FALLBACK,
    configValue,
    'callQualitySurveyPPM'
  );

  if (ppm == null) {
    log.error('getCallQualitySurveyPPM: Could not get PPM from remote config');
    return DEFAULT_PPM;
  }

  return ppm;
}
