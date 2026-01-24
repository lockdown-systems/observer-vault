// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { type ReactElement, useCallback } from 'react';

import { Button, ButtonVariant } from '../Button.dom.js';
import { TitlebarDragArea } from '../TitlebarDragArea.dom.js';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.js';
import { InstallScreenError } from '../../types/InstallScreen.std.js';

export type Props = Readonly<{
  error: InstallScreenError;
  quit: () => unknown;
  tryAgain: () => unknown;
}>;

export function InstallScreenErrorStep({
  error,
  quit,
  tryAgain,
}: Props): ReactElement {
  let errorMessage: string;
  const buttonText = 'Try Again';
  const onClickButton = useCallback(() => tryAgain(), [tryAgain]);
  const shouldShowQuitButton = true;

  switch (error) {
    case InstallScreenError.ConnectionFailed:
      errorMessage =
        'Connection failed. Please check your internet connection.';
      break;
    case InstallScreenError.InvalidPhoneNumber:
      errorMessage = 'The phone number you entered is not valid.';
      break;
    case InstallScreenError.CaptchaFailed:
      errorMessage = 'Captcha verification failed. Please try again.';
      break;
    case InstallScreenError.VerificationCodeExpired:
      errorMessage =
        'Your verification code has expired. Please request a new one.';
      break;
    case InstallScreenError.VerificationCodeIncorrect:
      errorMessage = 'The verification code you entered is incorrect.';
      break;
    case InstallScreenError.RateLimited:
      errorMessage =
        'Too many attempts. Please wait a few minutes and try again.';
      break;
    case InstallScreenError.RegistrationFailed:
      errorMessage = 'Registration failed. Please try again later.';
      break;
    // Legacy errors for compatibility
    case InstallScreenError.TooManyDevices:
      errorMessage = 'Too many devices are linked to this account.';
      break;
    case InstallScreenError.TooOld:
      errorMessage = 'This version of the app is too old.';
      break;
    case InstallScreenError.QRCodeFailed:
      errorMessage = 'QR code scanning failed.';
      break;
    default:
      errorMessage = 'An unknown error occurred.';
  }

  return (
    <div className="module-InstallScreenErrorStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <h1>Registration Error</h1>
      <h2>{errorMessage}</h2>

      <div className="module-InstallScreenErrorStep__buttons">
        <Button onClick={onClickButton}>{buttonText}</Button>
        {shouldShowQuitButton && (
          <Button onClick={() => quit()} variant={ButtonVariant.Secondary}>
            Quit
          </Button>
        )}
      </div>
    </div>
  );
}
