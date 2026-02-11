// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { itemStorage } from '../textsecure/Storage.preload.js';
import { onHasStoriesDisabledChange } from '../textsecure/WebAPI.preload.js';

export const getStoriesDisabled = (): boolean =>
  itemStorage.get('hasStoriesDisabled', false);

export const setStoriesDisabled = async (value: boolean): Promise<void> => {
  await itemStorage.put('hasStoriesDisabled', value);

  // Only update the conversation if it exists and the controller is ready
  try {
    const account = window.ConversationController.getOurConversation();
    if (account) {
      account.captureChange('hasStoriesDisabled');
    }
  } catch (error) {
    // ConversationController may not be ready yet (e.g., during app startup)
    // The setting is still saved to storage, so it will be applied when ready
  }

  onHasStoriesDisabledChange(value);
};

export const getStoriesBlocked = (): boolean => getStoriesDisabled();
