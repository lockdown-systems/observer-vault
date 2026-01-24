// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps } from 'react';
import React, { memo } from 'react';
import { useSelector } from 'react-redux';

import { getIntl } from '../selectors/user.std.js';
import { getInstallerState } from '../selectors/installer.std.js';
import { useInstallerActions } from '../ducks/installer.preload.js';
import { missingCaseError } from '../../util/missingCaseError.std.js';
import { InstallScreen } from '../../components/InstallScreen.dom.js';
import { WidthBreakpoint } from '../../components/_util.std.js';
import { InstallScreenStep } from '../../types/InstallScreen.std.js';
import { createLogger } from '../../logging/log.std.js';
import { SmartToastManager } from './ToastManager.preload.js';

const log = createLogger('InstallScreen');

type PropsType = ComponentProps<typeof InstallScreen>;

export const SmartInstallScreen = memo(function SmartInstallScreen() {
  const i18n = useSelector(getIntl);
  const installerState = useSelector(getInstallerState);
  const {
    startRegistration,
    submitPhoneNumber,
    submitCaptcha,
    submitVerificationCode,
    resendVerificationCode,
    goBack,
  } = useInstallerActions();

  let props: PropsType;

  switch (installerState.step) {
    case InstallScreenStep.NotStarted:
      log.error('Installer not started');
      return null;

    case InstallScreenStep.PhoneNumberEntry:
      props = {
        step: InstallScreenStep.PhoneNumberEntry,
        screenSpecificProps: {
          i18n,
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
          i18n,
          phoneNumber: installerState.phoneNumber,
          onCaptchaComplete: submitCaptcha,
          onBack: goBack,
          isSubmitting: installerState.isSubmitting,
          error: installerState.error,
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
