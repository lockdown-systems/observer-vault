// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps, ReactElement } from 'react';
import React from 'react';

import { missingCaseError } from '../util/missingCaseError.std.js';
import { InstallScreenStep } from '../types/InstallScreen.std.js';
import { InstallScreenErrorStep } from './installScreen/InstallScreenErrorStep.dom.js';
import { InstallScreenPhoneNumberStep } from './installScreen/InstallScreenPhoneNumberStep.dom.js';
import { InstallScreenCaptchaStep } from './installScreen/InstallScreenCaptchaStep.dom.js';
import { InstallScreenVerificationCodeStep } from './installScreen/InstallScreenVerificationCodeStep.dom.js';
import { InstallScreenCreatingAccountStep } from './installScreen/InstallScreenCreatingAccountStep.dom.js';
import { InstallScreenProfileNameStep } from './installScreen/InstallScreenProfileNameStep.dom.js';

// We can't always use destructuring assignment because of the complexity of this props
//   type.

type PropsType =
  | {
      step: InstallScreenStep.PhoneNumberEntry;
      screenSpecificProps: ComponentProps<typeof InstallScreenPhoneNumberStep>;
    }
  | {
      step: InstallScreenStep.CaptchaChallenge;
      screenSpecificProps: ComponentProps<typeof InstallScreenCaptchaStep>;
    }
  | {
      step: InstallScreenStep.VerificationCodeEntry;
      screenSpecificProps: ComponentProps<
        typeof InstallScreenVerificationCodeStep
      >;
    }
  | {
      step: InstallScreenStep.CreatingAccount;
      screenSpecificProps: ComponentProps<
        typeof InstallScreenCreatingAccountStep
      >;
    }
  | {
      step: InstallScreenStep.ProfileNameEntry;
      screenSpecificProps: ComponentProps<typeof InstallScreenProfileNameStep>;
    }
  | {
      step: InstallScreenStep.Error;
      screenSpecificProps: ComponentProps<typeof InstallScreenErrorStep>;
    };

export function InstallScreen(props: Readonly<PropsType>): ReactElement {
  switch (props.step) {
    case InstallScreenStep.Error:
      return <InstallScreenErrorStep {...props.screenSpecificProps} />;
    case InstallScreenStep.PhoneNumberEntry:
      return <InstallScreenPhoneNumberStep {...props.screenSpecificProps} />;
    case InstallScreenStep.CaptchaChallenge:
      return <InstallScreenCaptchaStep {...props.screenSpecificProps} />;
    case InstallScreenStep.VerificationCodeEntry:
      return (
        <InstallScreenVerificationCodeStep {...props.screenSpecificProps} />
      );
    case InstallScreenStep.CreatingAccount:
      return (
        <InstallScreenCreatingAccountStep {...props.screenSpecificProps} />
      );
    case InstallScreenStep.ProfileNameEntry:
      return <InstallScreenProfileNameStep {...props.screenSpecificProps} />;
    default:
      throw missingCaseError(props);
  }
}
