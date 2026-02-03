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
 *
 * IMPORTANT: Attachments are downloaded DIRECTLY (bypassing Signal's queue)
 * to ensure they are saved before the 30-second disappearing timer expires.
 */

import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

import { createLogger } from '../logging/log.std.js';
import { drop } from '../util/drop.std.js';
import { DurationInSeconds } from '../util/durations/index.std.js';
import { sleep } from '../util/sleep.std.js';
import * as RemoteConfig from '../RemoteConfig.dom.js';
import {
  isDirectConversation,
  isGroupV2,
} from '../util/whatTypeOfConversation.dom.js';
import {
  isDownloaded,
  hasRequiredInformationToDownloadFromTransitTier,
} from '../util/Attachment.std.js';
import {
  loadAttachmentData,
  saveAttachmentToDisk,
  getUnusedFilename,
  processNewAttachment,
} from '../util/migrations.preload.js';
import { downloadAttachment } from '../util/downloadAttachment.preload.js';
import type { AttachmentType } from '../types/Attachment.std.js';
import type { ConversationModel } from '../models/conversations.preload.js';
import type { MessageModel } from '../models/messages.preload.js';
import { getMessageById } from '../messages/getMessageById.preload.js';
import {
  getMaximumIncomingAttachmentSizeInKb,
  KIBIBYTE,
} from '../types/AttachmentSize.std.js';

const log = createLogger('observervault/messageHandler');

// The desired disappearing messages timer (30 seconds)
const DESIRED_EXPIRE_TIMER = DurationInSeconds.fromSeconds(30);

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

// Track which attachments we've already saved to avoid duplicates
const savedAttachmentPaths = new Set<string>();
// Track which attachment digests we've already started downloading
const downloadingAttachments = new Set<string>();

/**
 * Directly downloads an attachment from Signal's servers and saves it to disk.
 * This bypasses Signal's download queue to ensure the attachment is saved
 * before the 30-second disappearing message timer expires.
 */
async function directDownloadAndSave(
  attachment: AttachmentType,
  logId: string
): Promise<boolean> {
  const attachmentId = attachment.digest || attachment.cdnKey || 'unknown';

  // Skip if already downloading or downloaded
  if (downloadingAttachments.has(attachmentId)) {
    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Already downloading ${attachmentId}`
    );
    return false;
  }

  // Skip if already downloaded (has a path)
  if (attachment.path && savedAttachmentPaths.has(attachment.path)) {
    // eslint-disable-next-line no-console
    console.log(`[Observer Vault] ${logId}: Already saved ${attachment.path}`);
    return true;
  }

  // Check if we have enough info to download
  if (!hasRequiredInformationToDownloadFromTransitTier(attachment)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Observer Vault] ${logId}: Attachment missing download info (cdnKey/key/digest)`
    );
    return false;
  }

  // Check size limit
  const maxSizeKb = getMaximumIncomingAttachmentSizeInKb(RemoteConfig.getValue);
  if (attachment.size > maxSizeKb * KIBIBYTE) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Observer Vault] ${logId}: Attachment too large (${attachment.size} > ${maxSizeKb * KIBIBYTE})`
    );
    return false;
  }

  downloadingAttachments.add(attachmentId);

  try {
    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Direct downloading attachment ${attachmentId} (${attachment.size} bytes)`
    );

    // Create an abort controller with a 2-minute timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 120000);

    try {
      // Download the attachment directly
      const downloadedAttachment = await downloadAttachment({
        attachment,
        options: {
          onSizeUpdate: () => {
            // We don't need progress updates
          },
          abortSignal: abortController.signal,
          hasMediaBackups: false,
          logId: `${logId}/direct`,
          messageExpiresAt: null, // Don't check expiration - we want to download anyway
        },
      });

      clearTimeout(timeoutId);

      // eslint-disable-next-line no-console
      console.log(
        `[Observer Vault] ${logId}: Download complete, processing attachment`
      );

      // Process the attachment (decrypt and save to Signal's storage)
      const processedAttachment = await processNewAttachment(
        {
          ...attachment,
          ...downloadedAttachment,
        },
        'attachment'
      );

      // eslint-disable-next-line no-console
      console.log(
        `[Observer Vault] ${logId}: Processed, path=${processedAttachment.path}`
      );

      if (!processedAttachment.path) {
        // eslint-disable-next-line no-console
        console.error(`[Observer Vault] ${logId}: No path after processing`);
        return false;
      }

      // Now load the data and save to ObserverVault folder
      const attachmentWithData = await loadAttachmentData(processedAttachment);

      if (!attachmentWithData.data) {
        // eslint-disable-next-line no-console
        console.error(`[Observer Vault] ${logId}: No data after loading`);
        return false;
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

      // Save to disk
      const result = await saveAttachmentToDisk({
        data: attachmentWithData.data,
        name: uniqueName,
        baseDir: DOWNLOADS_DIR,
      });

      if (result) {
        savedAttachmentPaths.add(processedAttachment.path);

        // eslint-disable-next-line no-console
        console.log(
          `[Observer Vault] ${logId}: SUCCESS - Saved to ${result.fullPath}`
        );

        // Show notification
        try {
          // eslint-disable-next-line no-new
          new window.Notification('Observer Vault', {
            body: `File saved: ${uniqueName}`,
            silent: true,
          });
        } catch {
          // Notification may fail in some contexts
        }

        return true;
      }

      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[Observer Vault] ${logId}: Direct download failed:`, error);
    return false;
  } finally {
    downloadingAttachments.delete(attachmentId);
  }
}

/**
 * Immediately saves a downloaded attachment to the ObserverVault folder.
 * This is called directly from addAttachmentToMessage when an attachment
 * download completes, ensuring the file is saved before the message can expire.
 *
 * This is the primary save mechanism - it runs synchronously with download completion.
 */
export async function saveAttachmentToObserverVault(
  attachment: AttachmentType,
  messageId: string
): Promise<void> {
  const logId = `saveAttachmentToObserverVault/${messageId}`;

  // Skip if no path or already saved
  if (!attachment.path) {
    // eslint-disable-next-line no-console
    console.warn(`[Observer Vault] ${logId}: Attachment has no path`);
    return;
  }

  // Check if we've already saved this attachment
  if (savedAttachmentPaths.has(attachment.path)) {
    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Already saved ${attachment.path}, skipping`
    );
    return;
  }

  try {
    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Saving attachment immediately from ${attachment.path}`
    );

    // Load the decrypted attachment data
    const attachmentWithData = await loadAttachmentData(attachment);

    if (!attachmentWithData.data) {
      // eslint-disable-next-line no-console
      console.error(`[Observer Vault] ${logId}: No data in attachment`);
      return;
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
    console.log(`[Observer Vault] ${logId}: Saving as ${uniqueName}`);

    // Save to disk
    const result = await saveAttachmentToDisk({
      data: attachmentWithData.data,
      name: uniqueName,
      baseDir: DOWNLOADS_DIR,
    });

    if (result) {
      // Mark as saved to prevent duplicate saves
      savedAttachmentPaths.add(attachment.path);

      // eslint-disable-next-line no-console
      console.log(
        `[Observer Vault] ${logId}: SUCCESS - Saved to ${result.fullPath}`
      );

      // Show notification
      try {
        // eslint-disable-next-line no-new
        new window.Notification('Observer Vault', {
          body: `File saved: ${uniqueName}`,
          silent: true,
        });
      } catch {
        // Notification may fail in some contexts, that's OK
      }

      // Clean up old entries from the set to prevent memory leaks
      // Keep the last 1000 entries
      if (savedAttachmentPaths.size > 1000) {
        const entries = Array.from(savedAttachmentPaths);
        entries.slice(0, entries.length - 1000).forEach(path => {
          savedAttachmentPaths.delete(path);
        });
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[Observer Vault] ${logId}: Error saving attachment:`, error);
    throw error;
  }
}

/**
 * Waits for attachments to be downloaded by Signal's normal flow,
 * then saves them to the Downloads folder.
 *
 * NOTE: This is now a BACKUP mechanism. The primary save happens in
 * saveAttachmentToObserverVault which is called directly when attachments
 * are downloaded. This function catches any attachments that were missed.
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
      // Skip if already saved by the primary save mechanism or no path
      if (!attachment.path) {
        continue;
      }
      if (savedFiles.some(f => f === attachment.path)) {
        continue;
      }
      if (savedAttachmentPaths.has(attachment.path)) {
        // Already saved by saveAttachmentToObserverVault
        savedFiles.push(attachment.path);
        downloadedCount += 1;
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
          savedAttachmentPaths.add(attachment.path);
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

/**
 * Handles an incoming message for Observer Vault.
 * This is called from handleDataMessage for incoming messages.
 *
 * Returns true if the message was handled,
 * false if normal processing should continue.
 */
export async function handleObserverVaultIncomingMessage(
  message: MessageModel,
  conversation: ConversationModel
): Promise<boolean> {
  const logId = `handleObserverVaultIncomingMessage/${conversation.idForLogging()}`;

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

  // Check for attachments and download them IMMEDIATELY
  // We use direct download to bypass Signal's queue and ensure attachments
  // are saved before the 30-second disappearing timer expires
  const attachments = message.get('attachments') || [];
  if (attachments.length > 0) {
    const messageId = message.get('id');
    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Message has ${attachments.length} attachment(s), starting DIRECT download`
    );

    // Download all attachments in parallel, directly bypassing Signal's queue
    const downloadPromises = attachments.map(async (attachment, index) => {
      const attachmentLogId = `${logId}/attachment-${index}`;
      try {
        // First check if already downloaded
        if (isDownloaded(attachment) && attachment.path) {
          // eslint-disable-next-line no-console
          console.log(
            `[Observer Vault] ${attachmentLogId}: Already downloaded, saving`
          );
          await saveAttachmentToObserverVault(attachment, messageId);
          return true;
        }

        // Direct download and save
        return await directDownloadAndSave(attachment, attachmentLogId);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `[Observer Vault] ${attachmentLogId}: Failed to download:`,
          error
        );
        return false;
      }
    });

    // Wait for all downloads to complete (don't use drop() here!)
    const results = await Promise.all(downloadPromises);
    const successCount = results.filter(Boolean).length;

    // eslint-disable-next-line no-console
    console.log(
      `[Observer Vault] ${logId}: Downloaded ${successCount}/${attachments.length} attachments`
    );

    // Also start the backup polling mechanism in case direct download fails
    drop(downloadAllAttachments(message, conversation));
  }

  // Message processed (no auto-reply sent)
  return true;
}
