// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { type ReactElement, useState, useCallback } from 'react';

import { Button } from '../Button.dom.js';
import { TitlebarDragArea } from '../TitlebarDragArea.dom.js';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.js';

export type Props = Readonly<{
  onSubmitProfile: (firstName: string, lastName: string) => void;
  isSubmitting: boolean;
  error?: string;
}>;

export function InstallScreenProfileNameStep({
  onSubmitProfile,
  isSubmitting,
  error,
}: Props): ReactElement {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!firstName.trim()) {
        return;
      }

      onSubmitProfile(firstName.trim(), lastName.trim());
    },
    [firstName, lastName, onSubmitProfile]
  );

  return (
    <div className="module-InstallScreenProfileNameStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <div className="module-InstallScreenProfileNameStep__card">
        <h1 className="module-InstallScreenProfileNameStep__title">
          Set up your Observer Vault profile
        </h1>
        <p className="module-InstallScreenProfileNameStep__description">
          Enter a name for your Observer Vault&apos;s Signal account. If
          you&apos;re not sure what to use, just set the first name to
          &quot;Observer Vault&quot;.
        </p>

        <form
          onSubmit={handleSubmit}
          className="module-InstallScreenProfileNameStep__form"
        >
          <div className="module-InstallScreenProfileNameStep__input-wrapper">
            <input
              type="text"
              className="module-InstallScreenProfileNameStep__input"
              placeholder="First name (required)"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              disabled={isSubmitting}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div className="module-InstallScreenProfileNameStep__input-wrapper">
            <input
              type="text"
              className="module-InstallScreenProfileNameStep__input"
              placeholder="Last name (optional)"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="module-InstallScreenProfileNameStep__error">
              {error}
            </div>
          )}

          <div className="module-InstallScreenProfileNameStep__button">
            <Button type="submit" disabled={isSubmitting || !firstName.trim()}>
              {isSubmitting ? 'Saving...' : 'Finish'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
