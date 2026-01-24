// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { type ReactElement, useState, useCallback } from 'react';

import { Button, ButtonVariant } from '../Button.dom.js';
import { TitlebarDragArea } from '../TitlebarDragArea.dom.js';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.js';
import { Spinner } from '../Spinner.dom.js';

// Get the captcha URL from config (staging vs production)
const CAPTCHA_URL = window.SignalContext.config.registrationChallengeUrl;

export type Props = Readonly<{
  phoneNumber: string;
  onCaptchaComplete: (token: string) => void;
  onBack: () => void;
  isSubmitting: boolean;
  error?: string;
  requestCaptcha: () => Promise<string>;
}>;

export function InstallScreenCaptchaStep({
  phoneNumber,
  onCaptchaComplete,
  onBack,
  isSubmitting,
  error,
  requestCaptcha,
}: Props): ReactElement {
  const [isWaitingForCaptcha, setIsWaitingForCaptcha] = useState(false);
  const [captchaError, setCaptchaError] = useState<string | null>(null);

  const handleOpenCaptcha = useCallback(async () => {
    setIsWaitingForCaptcha(true);
    setCaptchaError(null);

    // Open the captcha URL in external browser
    // This will be intercepted by Electron's will-navigate handler
    document.location.href = CAPTCHA_URL;

    try {
      // Wait for the captcha token to come back via the signalcaptcha:// URL
      const token = await requestCaptcha();
      onCaptchaComplete(token);
    } catch (err) {
      setCaptchaError('Failed to complete captcha. Please try again.');
      setIsWaitingForCaptcha(false);
    }
  }, [requestCaptcha, onCaptchaComplete]);

  return (
    <div className="module-InstallScreenCaptchaStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <div className="module-InstallScreenCaptchaStep__card">
        <h1 className="module-InstallScreenCaptchaStep__title">
          Verify you're human
        </h1>
        <p className="module-InstallScreenCaptchaStep__description">
          Complete a captcha challenge to continue registration for{' '}
          <strong>{phoneNumber}</strong>
        </p>

        {(error || captchaError) && (
          <div className="module-InstallScreenCaptchaStep__error">
            {error || captchaError}
          </div>
        )}

        {isWaitingForCaptcha ? (
          <div className="module-InstallScreenCaptchaStep__waiting">
            <Spinner size="36px" svgSize="normal" />
            <span className="module-InstallScreenCaptchaStep__waiting-text">
              Complete the captcha in your browser, then click "Open Signal"
            </span>
          </div>
        ) : null}

        <div className="module-InstallScreenCaptchaStep__buttons">
          <Button
            onClick={handleOpenCaptcha}
            variant={ButtonVariant.Primary}
            disabled={isSubmitting || isWaitingForCaptcha}
          >
            {isWaitingForCaptcha ? 'Waiting for captcha...' : 'Open Captcha'}
          </Button>
          <Button
            onClick={onBack}
            variant={ButtonVariant.Secondary}
            disabled={isSubmitting}
          >
            Back
          </Button>
        </div>

        <p className="module-InstallScreenCaptchaStep__hint">
          After completing the captcha, click the "Open Signal" link to return
          here.
        </p>
      </div>
    </div>
  );
}
