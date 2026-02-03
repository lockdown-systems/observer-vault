// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ThunkAction } from 'redux-thunk';
import type { ReadonlyDeep } from 'type-fest';

import {
  ErrorCode,
  LibSignalErrorBase,
} from '@signalapp/libsignal-client';
import type { StateType as RootStateType } from '../reducer.preload.js';
import {
  InstallScreenStep,
  InstallScreenError,
  InstallScreenBackupStep,
  type InstallScreenBackupError,
} from '../../types/InstallScreen.std.js';
import * as Errors from '../../types/errors.std.js';
import { strictAssert } from '../../util/assert.std.js';
import { HTTPError } from '../../types/HTTPError.std.js';
import { requestVerification } from '../../textsecure/WebAPI.preload.js';
import { VerificationTransport } from '../../types/VerificationTransport.std.js';
import { accountManager } from '../../textsecure/AccountManager.preload.js';
import type { BoundActionCreatorsMapObject } from '../../hooks/useBoundActions.std.js';
import { useBoundActions } from '../../hooks/useBoundActions.std.js';
import { createLogger } from '../../logging/log.std.js';
import { writeProfile } from '../../services/writeProfile.preload.js';
import { getConversation } from '../../util/getConversation.preload.js';
import { DataWriter } from '../../sql/Client.preload.js';

const log = createLogger('installer');

// Backup import support - kept for compatibility
export type RetryBackupImportValue = ReadonlyDeep<'retry' | 'cancel'>;

export type InstallerStateType = ReadonlyDeep<
  | {
      step: InstallScreenStep.NotStarted;
    }
  | {
      step: InstallScreenStep.PhoneNumberEntry;
      isSubmitting: boolean;
      error?: string;
    }
  | {
      step: InstallScreenStep.CaptchaChallenge;
      phoneNumber: string;
      isSubmitting: boolean;
      error?: string;
    }
  | {
      step: InstallScreenStep.VerificationCodeEntry;
      phoneNumber: string;
      sessionId: string;
      isSubmitting: boolean;
      error?: string;
    }
  | {
      step: InstallScreenStep.CreatingAccount;
      phoneNumber: string;
      sessionId: string;
      verificationCode: string;
    }
  | {
      step: InstallScreenStep.ProfileNameEntry;
      isSubmitting: boolean;
      error?: string;
    }
  | {
      step: InstallScreenStep.BackupImport;
      backupStep: InstallScreenBackupStep;
      currentBytes: number;
      totalBytes: number;
      error?: InstallScreenBackupError;
    }
  | {
      step: InstallScreenStep.Error;
      error: InstallScreenError;
    }
>;

// Action types
export const START_REGISTRATION = 'installer/START_REGISTRATION';
const SET_SUBMITTING = 'installer/SET_SUBMITTING';
const SET_STEP_ERROR = 'installer/SET_STEP_ERROR';
const SHOW_CAPTCHA = 'installer/SHOW_CAPTCHA';
const SHOW_VERIFICATION_CODE = 'installer/SHOW_VERIFICATION_CODE';
const SHOW_CREATING_ACCOUNT = 'installer/SHOW_CREATING_ACCOUNT';
const SHOW_PROFILE_NAME_ENTRY = 'installer/SHOW_PROFILE_NAME_ENTRY';
const SET_ERROR = 'installer/SET_ERROR';
const RESET_TO_PHONE_NUMBER = 'installer/RESET_TO_PHONE_NUMBER';

// Backup import action types - kept for compatibility
export const SHOW_BACKUP_IMPORT = 'installer/SHOW_BACKUP_IMPORT';
const UPDATE_BACKUP_IMPORT_PROGRESS = 'installer/UPDATE_BACKUP_IMPORT_PROGRESS';
const RETRY_BACKUP_IMPORT = 'installer/RETRY_BACKUP_IMPORT';

export type StartRegistrationActionType = ReadonlyDeep<{
  type: typeof START_REGISTRATION;
}>;

type SetSubmittingActionType = ReadonlyDeep<{
  type: typeof SET_SUBMITTING;
  payload: boolean;
}>;

type SetStepErrorActionType = ReadonlyDeep<{
  type: typeof SET_STEP_ERROR;
  payload: string;
}>;

type ShowCaptchaActionType = ReadonlyDeep<{
  type: typeof SHOW_CAPTCHA;
  payload: { phoneNumber: string };
}>;

type ShowVerificationCodeActionType = ReadonlyDeep<{
  type: typeof SHOW_VERIFICATION_CODE;
  payload: { phoneNumber: string; sessionId: string };
}>;

type ShowCreatingAccountActionType = ReadonlyDeep<{
  type: typeof SHOW_CREATING_ACCOUNT;
  payload: { phoneNumber: string; sessionId: string; verificationCode: string };
}>;

type ShowProfileNameEntryActionType = ReadonlyDeep<{
  type: typeof SHOW_PROFILE_NAME_ENTRY;
}>;

type SetErrorActionType = ReadonlyDeep<{
  type: typeof SET_ERROR;
  payload: InstallScreenError;
}>;

type ResetToPhoneNumberActionType = ReadonlyDeep<{
  type: typeof RESET_TO_PHONE_NUMBER;
}>;

// Backup import action type definitions - kept for compatibility
export type ShowBackupImportActionType = ReadonlyDeep<{
  type: typeof SHOW_BACKUP_IMPORT;
}>;

type UpdateBackupImportProgressActionType = ReadonlyDeep<{
  type: typeof UPDATE_BACKUP_IMPORT_PROGRESS;
  payload:
    | {
        backupStep: InstallScreenBackupStep;
        currentBytes: number;
        totalBytes: number;
      }
    | {
        error: InstallScreenBackupError;
      };
}>;

type RetryBackupImportActionType = ReadonlyDeep<{
  type: typeof RETRY_BACKUP_IMPORT;
}>;

export type InstallerActionType = ReadonlyDeep<
  | StartRegistrationActionType
  | SetSubmittingActionType
  | SetStepErrorActionType
  | ShowCaptchaActionType
  | ShowVerificationCodeActionType
  | ShowCreatingAccountActionType
  | ShowProfileNameEntryActionType
  | SetErrorActionType
  | ResetToPhoneNumberActionType
  | ShowBackupImportActionType
  | UpdateBackupImportProgressActionType
  | RetryBackupImportActionType
>;

export const actions = {
  startRegistration,
  submitPhoneNumber,
  submitCaptcha,
  submitVerificationCode,
  resendVerificationCode,
  submitProfile,
  goBack,
  // Backup import actions - kept for compatibility
  showBackupImport,
  updateBackupImportProgress,
  handleMissingBackup,
};

export const useInstallerActions = (): BoundActionCreatorsMapObject<
  typeof actions
> => useBoundActions(actions);

function startRegistration(): ThunkAction<
  void,
  RootStateType,
  unknown,
  InstallerActionType
> {
  return async dispatch => {
    log.info('Starting registration flow');
    window.IPC.addSetupMenuItems();

    dispatch({
      type: START_REGISTRATION,
    });
  };
}

function submitPhoneNumber(
  phoneNumber: string
): ThunkAction<void, RootStateType, unknown, InstallerActionType> {
  return async dispatch => {
    log.info('Submitting phone number for registration');

    dispatch({ type: SET_SUBMITTING, payload: true });

    // For now, we always require captcha, so just move to captcha step
    // In the future, we could check if captcha is required via the API
    dispatch({
      type: SHOW_CAPTCHA,
      payload: { phoneNumber },
    });
  };
}

function submitCaptcha(
  captchaToken: string
): ThunkAction<void, RootStateType, unknown, InstallerActionType> {
  return async (dispatch, getState) => {
    const state = getState();
    strictAssert(
      state.installer.step === InstallScreenStep.CaptchaChallenge,
      'Wrong step for captcha submission'
    );

    const { phoneNumber } = state.installer;
    log.info('Submitting captcha and requesting verification code');

    dispatch({ type: SET_SUBMITTING, payload: true });

    try {
      // Request verification via SMS
      const result = await requestVerification(
        phoneNumber,
        captchaToken,
        VerificationTransport.SMS
      );

      dispatch({
        type: SHOW_VERIFICATION_CODE,
        payload: {
          phoneNumber,
          sessionId: result.sessionId,
        },
      });
    } catch (error) {
      log.error('Failed to request verification:', Errors.toLogFormat(error));

      if (error instanceof HTTPError) {
        if (error.code === 429) {
          dispatch({
            type: SET_ERROR,
            payload: InstallScreenError.RateLimited,
          });
          return;
        }
      }

      // Check for libsignal errors
      if (error instanceof LibSignalErrorBase) {
        switch (error.code) {
          case ErrorCode.RateLimitedError: {
            const retryAfterSecs = (error as { retryAfterSecs?: number })
              .retryAfterSecs;
            if (retryAfterSecs != null && retryAfterSecs > 0) {
              dispatch({
                type: SET_STEP_ERROR,
                payload: `Rate limited. Please try again in ${Math.ceil(retryAfterSecs)} seconds.`,
              });
            } else {
              dispatch({
                type: SET_ERROR,
                payload: InstallScreenError.RateLimited,
              });
            }
            return;
          }
          case ErrorCode.IoError:
          case ErrorCode.ChatServiceInactive:
          case ErrorCode.PossibleCaptiveNetwork:
            dispatch({
              type: SET_ERROR,
              payload: InstallScreenError.ConnectionFailed,
            });
            return;
          case ErrorCode.AppExpired:
            dispatch({
              type: SET_STEP_ERROR,
              payload:
                'This version of the app is no longer supported. Please update to continue.',
            });
            return;
          default:
            // Fall through to generic error handling
            break;
        }
      }

      dispatch({
        type: SET_STEP_ERROR,
        payload: 'Failed to send verification code. Please try again.',
      });
    }
  };
}

function submitVerificationCode(
  code: string
): ThunkAction<void, RootStateType, unknown, InstallerActionType> {
  return async (dispatch, getState) => {
    const state = getState();
    strictAssert(
      state.installer.step === InstallScreenStep.VerificationCodeEntry,
      'Wrong step for code submission'
    );

    const { phoneNumber, sessionId } = state.installer;
    log.info('Submitting verification code');

    dispatch({ type: SET_SUBMITTING, payload: true });
    dispatch({
      type: SHOW_CREATING_ACCOUNT,
      payload: { phoneNumber, sessionId, verificationCode: code },
    });

    try {
      // Register the account as a primary device
      await accountManager.registerSingleDevice(phoneNumber, code, sessionId);

      log.info('Registration successful! Showing profile name entry.');
      window.IPC.removeSetupMenuItems();

      // Show profile name entry step instead of finishing
      dispatch({ type: SHOW_PROFILE_NAME_ENTRY });
    } catch (error) {
      log.error('Registration failed:', Errors.toLogFormat(error));

      if (error instanceof HTTPError) {
        if (error.code === 403) {
          // Invalid verification code
          dispatch({
            type: SET_ERROR,
            payload: InstallScreenError.VerificationCodeIncorrect,
          });
          return;
        }
        if (error.code === 429) {
          dispatch({
            type: SET_ERROR,
            payload: InstallScreenError.RateLimited,
          });
          return;
        }
      }

      // Check for libsignal errors
      if (error instanceof LibSignalErrorBase) {
        switch (error.code) {
          case ErrorCode.RateLimitedError:
            dispatch({
              type: SET_ERROR,
              payload: InstallScreenError.RateLimited,
            });
            return;
          case ErrorCode.IoError:
          case ErrorCode.ChatServiceInactive:
          case ErrorCode.PossibleCaptiveNetwork:
            dispatch({
              type: SET_ERROR,
              payload: InstallScreenError.ConnectionFailed,
            });
            return;
          case ErrorCode.AppExpired:
            dispatch({
              type: SET_ERROR,
              payload: InstallScreenError.RegistrationFailed,
            });
            return;
          default:
            // Fall through to generic error handling
            break;
        }
      }

      dispatch({
        type: SET_ERROR,
        payload: InstallScreenError.RegistrationFailed,
      });
    }
  };
}

function resendVerificationCode(): ThunkAction<
  void,
  RootStateType,
  unknown,
  InstallerActionType
> {
  return async (dispatch, getState) => {
    const state = getState();
    strictAssert(
      state.installer.step === InstallScreenStep.VerificationCodeEntry,
      'Wrong step for resending code'
    );

    const { phoneNumber } = state.installer;
    log.info('Resending verification code');

    // Go back to captcha to get a new code
    dispatch({
      type: SHOW_CAPTCHA,
      payload: { phoneNumber },
    });
  };
}

function submitProfile(
  firstName: string,
  lastName: string
): ThunkAction<void, RootStateType, unknown, InstallerActionType> {
  return async (dispatch, getState) => {
    const state = getState();
    strictAssert(
      state.installer.step === InstallScreenStep.ProfileNameEntry,
      'Wrong step for profile submission'
    );

    log.info('Submitting profile name');
    dispatch({ type: SET_SUBMITTING, payload: true });

    try {
      const us = window.ConversationController.getOurConversationOrThrow();
      us.set({ profileName: firstName, profileFamilyName: lastName });
      us.captureChange('registrationProfile');
      await DataWriter.updateConversation(us.attributes);

      await writeProfile(getConversation(us), {
        keepAvatar: true,
      });

      log.info('Profile saved successfully!');

      // Open the inbox to complete the registration flow
      window.reduxActions.app.openInbox();
    } catch (error) {
      log.error('Failed to save profile:', Errors.toLogFormat(error));
      dispatch({
        type: SET_STEP_ERROR,
        payload: 'Failed to save profile. Please try again.',
      });
    }
  };
}

function goBack(): ThunkAction<
  void,
  RootStateType,
  unknown,
  InstallerActionType
> {
  return async (dispatch, getState) => {
    const state = getState();

    switch (state.installer.step) {
      case InstallScreenStep.CaptchaChallenge:
      case InstallScreenStep.VerificationCodeEntry:
      case InstallScreenStep.Error:
        dispatch({ type: RESET_TO_PHONE_NUMBER });
        break;
      default:
        log.warn('Cannot go back from step:', state.installer.step);
    }
  };
}

// Backup import stub functions - kept for compatibility with backups service
function showBackupImport(): ThunkAction<
  void,
  RootStateType,
  unknown,
  InstallerActionType
> {
  return async dispatch => {
    log.info('showBackupImport called (stub)');
    dispatch({
      type: SHOW_BACKUP_IMPORT,
    });
  };
}

function updateBackupImportProgress(
  payload:
    | {
        backupStep: InstallScreenBackupStep;
        currentBytes: number;
        totalBytes: number;
      }
    | {
        error: InstallScreenBackupError;
      }
): ThunkAction<void, RootStateType, unknown, InstallerActionType> {
  return async dispatch => {
    log.info('updateBackupImportProgress called', payload);
    dispatch({
      type: UPDATE_BACKUP_IMPORT_PROGRESS,
      payload,
    });
  };
}

function handleMissingBackup(): ThunkAction<
  void,
  RootStateType,
  unknown,
  InstallerActionType
> {
  return async dispatch => {
    log.info('handleMissingBackup called (stub)');
    // Just continue without backup
    dispatch({ type: RESET_TO_PHONE_NUMBER });
  };
}

export function getEmptyState(): InstallerStateType {
  return {
    step: InstallScreenStep.NotStarted,
  };
}

export function reducer(
  state: Readonly<InstallerStateType> = getEmptyState(),
  action: Readonly<InstallerActionType>
): InstallerStateType {
  if (action.type === START_REGISTRATION) {
    return {
      step: InstallScreenStep.PhoneNumberEntry,
      isSubmitting: false,
    };
  }

  if (action.type === SET_SUBMITTING) {
    if (
      state.step === InstallScreenStep.PhoneNumberEntry ||
      state.step === InstallScreenStep.CaptchaChallenge ||
      state.step === InstallScreenStep.VerificationCodeEntry ||
      state.step === InstallScreenStep.ProfileNameEntry
    ) {
      return {
        ...state,
        isSubmitting: action.payload,
        error: undefined,
      };
    }
    return state;
  }

  if (action.type === SET_STEP_ERROR) {
    if (
      state.step === InstallScreenStep.PhoneNumberEntry ||
      state.step === InstallScreenStep.CaptchaChallenge ||
      state.step === InstallScreenStep.VerificationCodeEntry ||
      state.step === InstallScreenStep.ProfileNameEntry
    ) {
      return {
        ...state,
        isSubmitting: false,
        error: action.payload,
      };
    }
    return state;
  }

  if (action.type === SHOW_CAPTCHA) {
    return {
      step: InstallScreenStep.CaptchaChallenge,
      phoneNumber: action.payload.phoneNumber,
      isSubmitting: false,
    };
  }

  if (action.type === SHOW_VERIFICATION_CODE) {
    return {
      step: InstallScreenStep.VerificationCodeEntry,
      phoneNumber: action.payload.phoneNumber,
      sessionId: action.payload.sessionId,
      isSubmitting: false,
    };
  }

  if (action.type === SHOW_CREATING_ACCOUNT) {
    return {
      step: InstallScreenStep.CreatingAccount,
      phoneNumber: action.payload.phoneNumber,
      sessionId: action.payload.sessionId,
      verificationCode: action.payload.verificationCode,
    };
  }

  if (action.type === SHOW_PROFILE_NAME_ENTRY) {
    return {
      step: InstallScreenStep.ProfileNameEntry,
      isSubmitting: false,
    };
  }

  if (action.type === SET_ERROR) {
    return {
      step: InstallScreenStep.Error,
      error: action.payload,
    };
  }

  if (action.type === RESET_TO_PHONE_NUMBER) {
    return {
      step: InstallScreenStep.PhoneNumberEntry,
      isSubmitting: false,
    };
  }

  // Backup import reducers - kept for compatibility
  if (action.type === SHOW_BACKUP_IMPORT) {
    return {
      step: InstallScreenStep.BackupImport,
      backupStep: InstallScreenBackupStep.WaitForBackup,
      currentBytes: 0,
      totalBytes: 0,
    };
  }

  if (action.type === UPDATE_BACKUP_IMPORT_PROGRESS) {
    if (state.step !== InstallScreenStep.BackupImport) {
      return state;
    }
    if ('error' in action.payload) {
      return {
        ...state,
        error: action.payload.error,
      };
    }
    return {
      ...state,
      backupStep: action.payload.backupStep,
      currentBytes: action.payload.currentBytes,
      totalBytes: action.payload.totalBytes,
    };
  }

  return state;
}
