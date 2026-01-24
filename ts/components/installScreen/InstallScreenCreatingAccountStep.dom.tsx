// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { type ReactElement } from 'react';

import { TitlebarDragArea } from '../TitlebarDragArea.dom.js';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.js';
import { Spinner } from '../Spinner.dom.js';

export type Props = Readonly<{
  phoneNumber: string;
}>;

export function InstallScreenCreatingAccountStep({
  phoneNumber,
}: Props): ReactElement {
  return (
    <div className="module-InstallScreenCreatingAccountStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <div className="module-InstallScreenCreatingAccountStep__card">
        <h1 className="module-InstallScreenCreatingAccountStep__title">
          Creating your account
        </h1>
        <p className="module-InstallScreenCreatingAccountStep__description">
          Setting up Observer Vault for <strong>{phoneNumber}</strong>
        </p>

        <div className="module-InstallScreenCreatingAccountStep__spinner">
          <Spinner size="48px" svgSize="normal" />
        </div>

        <p className="module-InstallScreenCreatingAccountStep__status">
          Generating encryption keys and registering with Signal...
        </p>
      </div>
    </div>
  );
}
