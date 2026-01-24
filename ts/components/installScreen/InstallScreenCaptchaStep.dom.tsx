// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { type ReactElement, useEffect, useRef } from 'react';

import { Button, ButtonVariant } from '../Button.dom.js';
import { TitlebarDragArea } from '../TitlebarDragArea.dom.js';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.js';

// Get the captcha URL from config (staging vs production)
const CAPTCHA_URL = window.SignalContext.config.registrationChallengeUrl;

export type Props = Readonly<{
  phoneNumber: string;
  onCaptchaComplete: (token: string) => void;
  onBack: () => void;
  isSubmitting: boolean;
  error?: string;
}>;

export function InstallScreenCaptchaStep({
  phoneNumber,
  onCaptchaComplete,
  onBack,
  isSubmitting,
  error,
}: Props): ReactElement {
  const webviewRef = useRef<HTMLWebViewElement>(null);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    // Listen for messages from the captcha webview
    const handleMessage = (event: Event) => {
      const customEvent = event as CustomEvent<{
        channel: string;
        args: unknown[];
      }>;
      if (customEvent.detail?.channel === 'signal-captcha') {
        const token = customEvent.detail.args[0] as string;
        if (token) {
          onCaptchaComplete(token);
        }
      }
    };

    // For Electron webview, listen to ipc-message
    const handleIpcMessage = (event: Electron.IpcMessageEvent) => {
      if (event.channel === 'signal-captcha') {
        const token = event.args[0] as string;
        if (token) {
          onCaptchaComplete(token);
        }
      }
    };

    webview.addEventListener('ipc-message', handleIpcMessage as EventListener);
    webview.addEventListener('message', handleMessage);

    return () => {
      webview.removeEventListener(
        'ipc-message',
        handleIpcMessage as EventListener
      );
      webview.removeEventListener('message', handleMessage);
    };
  }, [onCaptchaComplete]);

  return (
    <div className="module-InstallScreenCaptchaStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <h1>Verify you're human</h1>
      <p className="module-InstallScreenCaptchaStep__description">
        Complete the captcha to continue registration for {phoneNumber}
      </p>

      {error && (
        <div className="module-InstallScreenCaptchaStep__error">{error}</div>
      )}

      <div className="module-InstallScreenCaptchaStep__webview-container">
        {/* Using an iframe for captcha - in production this would be an Electron webview */}
        <webview
          ref={webviewRef as React.RefObject<HTMLWebViewElement>}
          src={CAPTCHA_URL}
          className="module-InstallScreenCaptchaStep__webview"
          partition="captcha"
          // @ts-expect-error - Electron webview attributes
          nodeintegration="false"
          contextIsolation="true"
        />
      </div>

      <div className="module-InstallScreenCaptchaStep__buttons">
        <Button
          onClick={onBack}
          variant={ButtonVariant.Secondary}
          disabled={isSubmitting}
        >
          Back
        </Button>
      </div>
    </div>
  );
}
