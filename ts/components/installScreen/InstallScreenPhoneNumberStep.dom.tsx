// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { type ReactElement, useState, useCallback } from 'react';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

import { Button } from '../Button.dom.js';
import { TitlebarDragArea } from '../TitlebarDragArea.dom.js';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.js';

export type Props = Readonly<{
  onSubmitPhoneNumber: (phoneNumber: string) => void;
  isSubmitting: boolean;
  error?: string;
}>;

export function InstallScreenPhoneNumberStep({
  onSubmitPhoneNumber,
  isSubmitting,
  error,
}: Props): ReactElement {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [validationError, setValidationError] = useState<string | undefined>();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError(undefined);

      // Try to parse and validate the phone number
      try {
        if (!isValidPhoneNumber(phoneNumber)) {
          setValidationError('Please enter a valid phone number');
          return;
        }
        const parsed = parsePhoneNumber(phoneNumber);
        if (!parsed) {
          setValidationError('Please enter a valid phone number');
          return;
        }
        // Get E.164 format
        const e164 = parsed.format('E.164');
        onSubmitPhoneNumber(e164);
      } catch {
        setValidationError(
          'Please enter a valid phone number with country code'
        );
      }
    },
    [phoneNumber, onSubmitPhoneNumber]
  );

  const displayError = error || validationError;

  return (
    <div className="module-InstallScreenPhoneNumberStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <div className="module-InstallScreenPhoneNumberStep__card">
        <h1 className="module-InstallScreenPhoneNumberStep__title">
          Enter a phone number that isn&apos;t already registered with Signal
        </h1>
        <p className="module-InstallScreenPhoneNumberStep__description">
          Use a different number than your existing Signal account — registering
          here will take over that number.
        </p>

        <form
          onSubmit={handleSubmit}
          className="module-InstallScreenPhoneNumberStep__form"
        >
          <div className="module-InstallScreenPhoneNumberStep__input-wrapper">
            <input
              type="tel"
              className="module-InstallScreenPhoneNumberStep__input"
              placeholder="+1 (555) 123-4567"
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              disabled={isSubmitting}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          {displayError && (
            <div className="module-InstallScreenPhoneNumberStep__error">
              {displayError}
            </div>
          )}

          <div className="module-InstallScreenPhoneNumberStep__button">
            <Button
              type="submit"
              disabled={isSubmitting || !phoneNumber.trim()}
            >
              {isSubmitting ? 'Sending code...' : 'Continue'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
