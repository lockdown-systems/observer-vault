// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Video Stash Message Handler
 *
 * This module handles incoming messages for the Video Stash application.
 * It implements:
 * 1. Auto-reply functionality for text messages
 * 2. Automatic disappearing messages timer configuration
 */

import { createLogger } from '../logging/log.std.js';
import { drop } from '../util/drop.std.js';
import { DurationInSeconds } from '../util/durations/index.std.js';
import {
  isDirectConversation,
  isGroupV2,
} from '../util/whatTypeOfConversation.dom.js';
import type { ConversationModel } from '../models/conversations.preload.js';
import type { MessageModel } from '../models/messages.preload.js';

const log = createLogger('videostash/messageHandler');

// The auto-reply message for text messages
const AUTO_REPLY_MESSAGE = "sorry I'm busy";

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
        reason: 'videostash-auto-set',
        version: undefined,
      });
    } else if (isDirectConversation(conversation.attributes)) {
      // Direct conversations can use updateExpirationTimer directly
      await conversation.updateExpirationTimer(DESIRED_EXPIRE_TIMER, {
        reason: 'videostash-auto-set',
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

/**
 * Sends an auto-reply message to the conversation.
 */
export async function sendAutoReply(
  conversation: ConversationModel
): Promise<void> {
  const logId = `sendAutoReply/${conversation.idForLogging()}`;

  log.info(`${logId}: Sending auto-reply message`);

  try {
    await conversation.enqueueMessageForSend(
      {
        attachments: [],
        body: AUTO_REPLY_MESSAGE,
      },
      {
        timestamp: Date.now(),
      }
    );
    log.info(`${logId}: Auto-reply message sent successfully`);
  } catch (error) {
    log.error(
      `${logId}: Failed to send auto-reply:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Handles an incoming message for Video Stash.
 * This is called from handleDataMessage for incoming messages.
 *
 * Returns true if the message was handled (auto-reply sent),
 * false if normal processing should continue.
 */
export async function handleVideoStashIncomingMessage(
  message: MessageModel,
  conversation: ConversationModel
): Promise<boolean> {
  const logId = `handleVideoStashIncomingMessage/${conversation.idForLogging()}`;

  // Only handle incoming messages (not our own sent messages)
  const messageType = message.get('type');
  if (messageType !== 'incoming') {
    return false;
  }

  // First, ensure disappearing messages is set to 30 seconds
  drop(ensureDisappearingMessagesTimer(conversation));

  // Get the message body
  const body = message.get('body');

  // If the message has a text body, send an auto-reply
  if (body && body.trim().length > 0) {
    log.info(`${logId}: Received text message, sending auto-reply`);
    drop(sendAutoReply(conversation));
    return true;
  }

  // For messages without text (e.g., attachments, reactions), we still process them
  // but don't send an auto-reply
  log.info(`${logId}: Received non-text message, no auto-reply needed`);
  return false;
}
