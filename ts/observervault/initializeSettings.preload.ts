// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Observer Vault Settings Initialization
 *
 * This module ensures Observer Vault-specific settings are configured on launch.
 */

import { createLogger } from '../logging/log.std.js';
import { setStoriesDisabled } from '../util/stories.preload.js';

const log = createLogger('observervault/initializeSettings');

/**
 * Initializes Observer Vault settings on application launch.
 * This ensures:
 * 1. Stories are disabled
 * 2. Microphone access is disabled
 * 3. Camera access is disabled
 */
export async function initializeObserverVaultSettings(): Promise<void> {
  log.info('Initializing Observer Vault settings...');

  // 1. Disable stories if not already disabled
  try {
    const { getStoriesDisabled } = await import('../util/stories.preload.js');
    const storiesDisabled = getStoriesDisabled();
    
    if (!storiesDisabled) {
      log.info('Stories not disabled, disabling now...');
      await setStoriesDisabled(true);
      log.info('Stories disabled successfully');
    } else {
      log.info('Stories already disabled');
    }
  } catch (error) {
    log.error('Failed to disable stories:', error);
  }

  // 2. Disable microphone access
  try {
    const hasMediaPermissions = await window.Events.getMediaPermissions();
    
    if (hasMediaPermissions !== false) {
      log.info('Microphone access not disabled, disabling now...');
      await window.IPC.setMediaPermissions(false);
      log.info('Microphone access disabled successfully');
    } else {
      log.info('Microphone access already disabled');
    }
  } catch (error) {
    log.error('Failed to disable microphone access:', error);
  }

  // 3. Disable camera access
  try {
    const hasMediaCameraPermissions = await window.Events.getMediaCameraPermissions();
    
    if (hasMediaCameraPermissions !== false) {
      log.info('Camera access not disabled, disabling now...');
      await window.IPC.setMediaCameraPermissions(false);
      log.info('Camera access disabled successfully');
    } else {
      log.info('Camera access already disabled');
    }
  } catch (error) {
    log.error('Failed to disable camera access:', error);
  }

  log.info('Observer Vault settings initialization complete');
}
