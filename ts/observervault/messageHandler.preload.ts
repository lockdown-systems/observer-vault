// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Observer Vault Message Handler
 *
 * This module handles incoming messages for the Observer Vault application.
 * It implements:
 * 1. Auto-reply functionality for text messages
 * 2. Automatic disappearing messages timer configuration
 * 3. Auto-download of all attachments to Downloads folder
 */

import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

import { createLogger } from '../logging/log.std.js';
import { drop } from '../util/drop.std.js';
import { DurationInSeconds } from '../util/durations/index.std.js';
import { sleep } from '../util/sleep.std.js';
import {
  isDirectConversation,
  isGroupV2,
} from '../util/whatTypeOfConversation.dom.js';
import { isDownloaded } from '../util/Attachment.std.js';
import {
  loadAttachmentData,
  saveAttachmentToDisk,
  getUnusedFilename,
} from '../util/migrations.preload.js';
import type { AttachmentType } from '../types/Attachment.std.js';
import type { ConversationModel } from '../models/conversations.preload.js';
import type { MessageModel } from '../models/messages.preload.js';
import { getMessageById } from '../messages/getMessageById.preload.js';

const log = createLogger('observervault/messageHandler');

// The auto-reply message for text messages
const AUTO_REPLY_MESSAGE = "sorry I'm busy";

// The message sent when rejecting an audio-only call
const AUDIO_CALL_REJECTION_MESSAGE = "can't talk sorry";

// The desired disappearing messages timer (1 minute)
const DESIRED_EXPIRE_TIMER = DurationInSeconds.fromSeconds(60);

// Default Downloads folder - use ObserverVault subfolder
const DOWNLOADS_DIR = join(homedir(), 'Downloads', 'ObserverVault');

// Ensure the directory exists
if (!existsSync(DOWNLOADS_DIR)) {
  mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Gets a file extension from content type or filename
 */
function getExtensionFromContentType(
  contentType: string | undefined,
  fileName: string | undefined
): string {
  // Try to get extension from filename first
  if (fileName) {
    const ext = extname(fileName).replace(/^\./, '');
    if (ext) {
      return ext;
    }
  }

  if (!contentType) {
    return 'bin';
  }

  // Common MIME type mappings
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/aac': 'aac',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'text/plain': 'txt',
  };

  if (mimeToExt[contentType]) {
    return mimeToExt[contentType];
  }

  // Try to extract from MIME type (e.g., image/png -> png)
  const parts = contentType.split('/');
  if (parts.length === 2) {
    const subtype = parts[1].split(';')[0];
    if (subtype && subtype.length <= 10 && /^[a-z0-9]+$/i.test(subtype)) {
      return subtype;
    }
  }

  return 'bin';
}

/**
 * Waits for attachments to be downloaded by Signal's normal flow,
 * then saves them to the Downloads folder.
 */
export async function downloadAllAttachments(
  message: MessageModel,
  conversation: ConversationModel
): Promise<void> {
  const logId = `downloadAllAttachments/${conversation.idForLogging()}`;
  const messageId = message.get('id');
  const attachments = message.get('attachments') || [];

  // eslint-disable-next-line no-console
  console.log(
    `[Observer Vault] ${logId}: Watching for ${attachments.length} attachment(s) to download, messageId=${messageId}`
  );

  if (attachments.length === 0) {
    log.info(`${logId}: No attachments to download`);
    return;
  }

  // Poll for downloads to complete (Signal's normal flow handles the actual download)
  const MAX_DOWNLOAD_WAIT_MS = 120000; // 2 minutes for large files
  const DOWNLOAD_POLL_MS = 1000;
  const startTime = Date.now();

  let downloadedCount = 0;
  const savedFiles: Array<string> = [];

  while (Date.now() - startTime < MAX_DOWNLOAD_WAIT_MS) {
    // eslint-disable-next-line no-await-in-loop
    const updatedMessage = await getMessageById(messageId);
    if (!updatedMessage) {
      // eslint-disable-next-line no-console
      console.error(`[Observer Vault] ${logId}: Message disappeared`);
      break;
    }

    const currentAttachments = updatedMessage.get('attachments') || [];
    const downloadedAttachments = currentAttachments.filter(
      (att: AttachmentType) => isDownloaded(att)
    );

    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Download progress: ${downloadedAttachments.length}/${currentAttachments.length}`
    );

    // Save any newly downloaded attachments to Downloads folder
    for (const attachment of downloadedAttachments) {
      // Skip if already saved or no path
      if (savedFiles.some(f => f === attachment.path) || !attachment.path) {
        continue;
      }

      try {
        // eslint-disable-next-line no-console
        console.log(
          `[Observer Vault] ${logId}: Loading decrypted data from ${attachment.path}`
        );

        // eslint-disable-next-line no-await-in-loop
        const attachmentWithData = await loadAttachmentData(attachment);

        if (!attachmentWithData.data) {
          // eslint-disable-next-line no-console
          console.error(`[Observer Vault] ${logId}: No data in attachment`);
          continue;
        }

        // Generate filename
        const timestamp = Date.now();
        const ext = getExtensionFromContentType(
          attachment.contentType,
          attachment.fileName
        );
        const baseName =
          attachment.fileName || `signal-attachment-${timestamp}.${ext}`;

        const uniqueName = getUnusedFilename({
          filename: baseName,
          baseDir: DOWNLOADS_DIR,
        });

        // eslint-disable-next-line no-console
        console.log(
          `[Observer Vault] ${logId}: Saving to Downloads as ${uniqueName}`
        );

        // eslint-disable-next-line no-await-in-loop
        const result = await saveAttachmentToDisk({
          data: attachmentWithData.data,
          name: uniqueName,
          baseDir: DOWNLOADS_DIR,
        });

        if (result) {
          // eslint-disable-next-line no-console
          console.log(
            `[Observer Vault] ${logId}: SUCCESS - Saved to ${result.fullPath}`
          );
          savedFiles.push(attachment.path);
          downloadedCount += 1;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `[Observer Vault] ${logId}: Error saving attachment:`,
          error
        );
      }
    }

    // Check if all done
    if (
      downloadedAttachments.length >= currentAttachments.length &&
      currentAttachments.length > 0
    ) {
      // eslint-disable-next-line no-console
      console.log(
        `[Observer Vault] ${logId}: All ${downloadedAttachments.length} attachments downloaded and saved`
      );
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(DOWNLOAD_POLL_MS);
  }

  // Show notification
  if (downloadedCount > 0) {
    const notificationBody =
      downloadedCount === 1
        ? 'File saved to Downloads/ObserverVault'
        : `${downloadedCount} files saved to Downloads/ObserverVault`;

    try {
      // eslint-disable-next-line no-new
      new window.Notification('Observer Vault', {
        body: notificationBody,
        silent: true,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[Observer Vault] ${logId}: Notification: ${notificationBody}`
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `[Observer Vault] ${logId}: Failed to show notification:`,
        error
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[Observer Vault] ${logId}: Timeout - no attachments were saved`
    );
  }
}

/**
 * Checks if a conversation has the correct disappearing messages timer set.
 * If not, sets it to 2 minutes.
 */
export async function ensureDisappearingMessagesTimer(
  conversation: ConversationModel
): Promise<void> {
  const logId = `ensureDisappearingMessagesTimer/${conversation.idForLogging()}`;

  const currentTimer = conversation.get('expireTimer');

  // Check if the timer is already set to 2 minutes
  if (currentTimer === DESIRED_EXPIRE_TIMER) {
    log.info(`${logId}: Disappearing messages already set to 2 minutes`);
    return;
  }

  log.info(
    `${logId}: Setting disappearing messages to 2 minutes (was: ${currentTimer ?? 'disabled'})`
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
 * Sends a rejection message when an audio-only call is declined.
 * This is called from the calling service when an audio call is rejected.
 */
export async function sendAudioCallRejectionMessage(
  conversation: ConversationModel
): Promise<void> {
  const logId = `sendAudioCallRejectionMessage/${conversation.idForLogging()}`;

  log.info(`${logId}: Sending audio call rejection message`);

  try {
    await conversation.enqueueMessageForSend(
      {
        attachments: [],
        body: AUDIO_CALL_REJECTION_MESSAGE,
      },
      {
        timestamp: Date.now(),
      }
    );
    log.info(`${logId}: Audio call rejection message sent successfully`);
  } catch (error) {
    log.error(
      `${logId}: Failed to send audio call rejection message:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Handles an incoming message for Observer Vault.
 * This is called from handleDataMessage for incoming messages.
 *
 * Returns true if the message was handled,
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

  // eslint-disable-next-line no-console
  console.log(`[Observer Vault] ${logId}: Processing incoming message`);

  // First, ensure disappearing messages is set to 2 minutes
  drop(ensureDisappearingMessagesTimer(conversation));

  // Auto-select the conversation to mark messages as read
  // This triggers the normal "mark as read" behavior
  window.reduxActions?.conversations?.showConversation({
    conversationId: conversation.id,
  });
  log.info(`${logId}: Auto-selected conversation to mark as read`);

  // Check for attachments and download them
  const attachments = message.get('attachments') || [];
  if (attachments.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Message has ${attachments.length} attachment(s), starting download`
    );
    drop(downloadAllAttachments(message, conversation));
    // Don't send auto-reply for attachment messages
    return true;
  }

  // Get the message body
  const body = message.get('body');

  // If the message has a text body, send an auto-reply
  if (body && body.trim().length > 0) {
    log.info(`${logId}: Received text message, sending auto-reply`);
    drop(sendAutoReply(conversation));
    return true;
  }

  // For messages without text or attachments (e.g., reactions), we still process them
  // but don't send an auto-reply
  log.info(
    `${logId}: Received non-text/non-attachment message, no auto-reply needed`
  );
  return false;
}
