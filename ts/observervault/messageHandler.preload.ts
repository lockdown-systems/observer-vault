// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Observer Vault Message Handler
 *
 * This module handles incoming messages for the Observer Vault application.
 * It implements automatic disappearing messages timer configuration.
 */

import { createLogger } from '../logging/log.std.js';
import { DurationInSeconds } from '../util/durations/index.std.js';
import {
  isDirectConversation,
  isGroupV2,
} from '../util/whatTypeOfConversation.dom.js';
import { getMessageById } from '../messages/getMessageById.preload.js';
import type { ConversationModel } from '../models/conversations.preload.js';

// Re-export getMessageById so we have a real preload import
export { getMessageById };

const log = createLogger('observervault/messageHandler');

// The desired disappearing messages timer (30 seconds)
const DESIRED_EXPIRE_TIMER = DurationInSeconds.fromSeconds(30);

/**
 * Checks if a conversation has the correct disappearing messages timer set.
 * If not, sets it to 30 seconds.
 */
export async function ensureDisappearingMessagesTimer(
  conversation: ConversationModel
): Promise<void> {
  const logId = `ensureDisappearingMessagesTimer/${conversation.idForLogging()}`;

  const currentTimer = conversation.get('expireTimer');

  // Check if the timer is already set to 30 seconds
  if (currentTimer === DESIRED_EXPIRE_TIMER) {
    log.info(`${logId}: Disappearing messages already set to 30 seconds`);
    return;
  }

  log.info(
    `${logId}: Setting disappearing messages to 30 seconds (was: ${currentTimer ?? 'disabled'})`
  );

  try {
    // For GroupV2 conversations, we need to use a different method
    if (isGroupV2(conversation.attributes)) {
      // GroupV2 conversations need to go through group modification
      await conversation.updateExpirationTimer(DESIRED_EXPIRE_TIMER, {
        reason: 'observervault-auto-set',
        version: undefined,
      });
    } else if (isDirectConversation(conversation.attributes)) {
      // Direct conversations can use updateExpirationTimer directly
      await conversation.updateExpirationTimer(DESIRED_EXPIRE_TIMER, {
        reason: 'observervault-auto-set',
        version: undefined,
      });
    } else {
      log.warn(`${logId}: Unsupported conversation type for timer update`);
    }
  } catch (error) {
    log.error(
      `${logId}: Failed to set disappearing messages timer:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
