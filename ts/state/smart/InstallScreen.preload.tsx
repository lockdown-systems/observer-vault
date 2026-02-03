// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps } from 'react';
import React, { memo, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';

import { getInstallerState } from '../selectors/installer.std.js';
import { useInstallerActions } from '../ducks/installer.preload.js';
import { missingCaseError } from '../../util/missingCaseError.std.js';
import { InstallScreen } from '../../components/InstallScreen.dom.js';
import { WidthBreakpoint } from '../../components/_util.std.js';
import { InstallScreenStep } from '../../types/InstallScreen.std.js';
import { createLogger } from '../../logging/log.std.js';
import { SmartToastManager } from './ToastManager.preload.js';
import { challengeHandler } from '../../services/challengeHandler.preload.js';
import type { IPCResponse } from '../../challenge.dom.js';

const log = createLogger('InstallScreen');

type PropsType = ComponentProps<typeof InstallScreen>;

export const SmartInstallScreen = memo(function SmartInstallScreen() {
  const installerState = useSelector(getInstallerState);
  const {
    startRegistration,
    submitPhoneNumber,
    submitCaptcha,
    submitVerificationCode,
    resendVerificationCode,
    submitProfile,
    goBack,
  } = useInstallerActions();

  // Set up the challenge response listener for captcha during install
  useEffect(() => {
    const handleChallengeResponse = (response: IPCResponse) => {
      log.info('Received challenge response during install');
      challengeHandler.onResponse(response);
    };

    window.Whisper.events.on('challengeResponse', handleChallengeResponse);

    return () => {
      window.Whisper.events.off('challengeResponse', handleChallengeResponse);
    };
  }, []);

  // Function to request captcha token - waits for the signalcaptcha:// URL response
  const requestCaptcha = useCallback(async (): Promise<string> => {
    return challengeHandler.requestCaptcha({
      reason: 'registration',
    });
  }, []);

  let props: PropsType;

  switch (installerState.step) {
    case InstallScreenStep.NotStarted:
      log.error('Installer not started');
      return null;

    case InstallScreenStep.PhoneNumberEntry:
      props = {
        step: InstallScreenStep.PhoneNumberEntry,
        screenSpecificProps: {
          onSubmitPhoneNumber: submitPhoneNumber,
          isSubmitting: installerState.isSubmitting,
          error: installerState.error,
        },
      };
      break;

    case InstallScreenStep.CaptchaChallenge:
      props = {
        step: InstallScreenStep.CaptchaChallenge,
        screenSpecificProps: {
          phoneNumber: installerState.phoneNumber,
          onCaptchaComplete: submitCaptcha,
          onBack: goBack,
          isSubmitting: installerState.isSubmitting,
          error: installerState.error,
          requestCaptcha,
        },
      };
      break;

    case InstallScreenStep.VerificationCodeEntry:
      props = {
        step: InstallScreenStep.VerificationCodeEntry,
        screenSpecificProps: {
          phoneNumber: installerState.phoneNumber,
          onSubmitCode: submitVerificationCode,
          onResendCode: resendVerificationCode,
          onBack: goBack,
          isSubmitting: installerState.isSubmitting,
          error: installerState.error,
        },
      };
      break;

    case InstallScreenStep.CreatingAccount:
      props = {
        step: InstallScreenStep.CreatingAccount,
        screenSpecificProps: {
          phoneNumber: installerState.phoneNumber,
        },
      };
      break;

    case InstallScreenStep.ProfileNameEntry:
      props = {
        step: InstallScreenStep.ProfileNameEntry,
        screenSpecificProps: {
          onSubmitProfile: submitProfile,
          isSubmitting: installerState.isSubmitting,
          error: installerState.error,
        },
      };
      break;

    case InstallScreenStep.Error:
      props = {
        step: InstallScreenStep.Error,
        screenSpecificProps: {
          error: installerState.error,
          quit: () => window.IPC.shutdown(),
          tryAgain: startRegistration,
        },
      };
      break;

    case InstallScreenStep.BackupImport:
      // Backup import is not used in the new registration flow
      // but we need to handle the case for compatibility
      log.warn(
        'BackupImport step should not be reached in new registration flow'
      );
      return null;

    default:
      throw missingCaseError(installerState);
  }

  return (
    <>
      <InstallScreen {...props} />
      <SmartToastManager
        disableMegaphone
        containerWidthBreakpoint={WidthBreakpoint.Narrow}
      />
    </>
  );
});
