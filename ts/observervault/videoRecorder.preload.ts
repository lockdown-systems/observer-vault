// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Observer Vault Video Recorder
 *
 * Records incoming video call frames to MP4 files using WebCodecs + mediabunny.
 * No external dependencies like ffmpeg required.
 */

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  VideoSampleSource,
  VideoSample,
} from 'mediabunny';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { createLogger } from '../logging/log.std.js';

const log = createLogger('ObserverVault.VideoRecorder');

// Recording configuration
const TARGET_FPS = 30;
const FRAME_DURATION_SEC = 1 / TARGET_FPS;
// High bitrate for maximum quality: 10 Mbps (good for 1080p, overkill for lower res but ensures quality)
const VIDEO_BITRATE = 10_000_000;

// Get the downloads directory
function getRecordingsDirectory(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const recordingsDir = join(homeDir, 'Downloads', 'ObserverVault');

  if (!existsSync(recordingsDir)) {
    mkdirSync(recordingsDir, { recursive: true });
    log.info(`Created recordings directory: ${recordingsDir}`);
  }

  return recordingsDir;
}

// Generate a timestamped filename
function generateFilename(conversationId: string): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, -5);
  const sanitizedConvId = conversationId.slice(0, 8);
  return `call_${timestamp}_${sanitizedConvId}.mp4`;
}

interface RecordingState {
  isRecording: boolean;
  filePath: string | null;
  output: Output | null;
  videoSource: VideoSampleSource | null;
  frameCount: number;
  width: number;
  height: number;
  startTime: number;
  lastFrameTime: number;
  conversationId: string;
}

class VideoRecorder {
  private state: RecordingState = {
    isRecording: false,
    filePath: null,
    output: null,
    videoSource: null,
    frameCount: 0,
    width: 0,
    height: 0,
    startTime: 0,
    lastFrameTime: 0,
    conversationId: '',
  };

  /**
   * Start recording video frames
   */
  async startRecording(conversationId: string): Promise<string | null> {
    if (this.state.isRecording) {
      log.warn('Already recording, ignoring start request');
      return this.state.filePath;
    }

    // Check if WebCodecs is available
    if (typeof VideoEncoder === 'undefined') {
      log.error('WebCodecs VideoEncoder not available');
      return null;
    }

    const recordingsDir = getRecordingsDirectory();
    const filename = generateFilename(conversationId);
    const filePath = join(recordingsDir, filename);

    log.info(`Starting recording to: ${filePath}`);

    try {
      this.state = {
        isRecording: true,
        filePath,
        output: null,
        videoSource: null,
        frameCount: 0,
        width: 0,
        height: 0,
        startTime: Date.now(),
        lastFrameTime: 0,
        conversationId,
      };

      // eslint-disable-next-line no-console
      console.log(`[Observer Vault] Recording started: ${filePath}`);

      return filePath;
    } catch (err) {
      log.error('Failed to start recording:', err);
      return null;
    }
  }

  /**
   * Initialize encoder when we know the video dimensions
   */
  private async initializeEncoder(
    width: number,
    height: number
  ): Promise<boolean> {
    if (this.state.output) {
      return true;
    }

    log.info(`Initializing encoder for ${width}x${height}`);

    try {
      // Create video sample source with encoding config
      // Use sizeChangeBehavior: 'contain' to handle dimension changes
      // (e.g., when remote user flips camera from front to back)
      // Use explicit high bitrate for maximum quality
      const videoSource = new VideoSampleSource({
        codec: 'avc', // H.264
        bitrate: VIDEO_BITRATE, // 10 Mbps for high quality
        sizeChangeBehavior: 'contain', // Letterbox/pillarbox if dimensions change
      });

      // Create the output with BufferTarget (will write to file at end)
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      // Add the video track
      output.addVideoTrack(videoSource, { frameRate: TARGET_FPS });

      // Start the output
      await output.start();

      this.state.output = output;
      this.state.videoSource = videoSource;
      this.state.width = width;
      this.state.height = height;

      log.info('Encoder initialized successfully');
      return true;
    } catch (err) {
      log.error('Failed to initialize encoder:', err);
      return false;
    }
  }

  /**
   * Add a video frame to the recording
   * @param rgbaData - Raw RGBA pixel data
   * @param width - Frame width
   * @param height - Frame height
   */
  async addFrame(
    rgbaData: Uint8Array,
    width: number,
    height: number
  ): Promise<void> {
    if (!this.state.isRecording) {
      return;
    }

    // Initialize encoder on first frame with actual dimensions
    if (!this.state.output) {
      const success = await this.initializeEncoder(width, height);
      if (!success) {
        log.error('Failed to initialize encoder, stopping recording');
        await this.stopRecording();
        return;
      }
    }

    // Log dimension changes (e.g., camera flip) but don't skip - mediabunny handles it
    if (width !== this.state.width || height !== this.state.height) {
      log.info(
        `Frame dimensions changed from ${this.state.width}x${this.state.height} to ${width}x${height}, mediabunny will letterbox/pillarbox`
      );
    }

    try {
      // Calculate timestamp in seconds
      const now = Date.now();
      const timestampSec = (now - this.state.startTime) / 1000;

      // Rate limiting - skip frames if we're getting too many
      const minFrameInterval = 1000 / TARGET_FPS; // ms between frames
      if (
        this.state.lastFrameTime > 0 &&
        now - this.state.lastFrameTime < minFrameInterval * 0.5
      ) {
        return; // Skip this frame, coming in too fast
      }
      this.state.lastFrameTime = now;

      // Create VideoSample from RGBA data
      // VideoSample can be constructed from raw pixel data with format specified
      const videoSample = new VideoSample(rgbaData, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: timestampSec,
        duration: FRAME_DURATION_SEC,
      });

      // Add sample to the video source
      if (this.state.videoSource) {
        await this.state.videoSource.add(videoSample);
      }

      // Close the sample to free memory
      videoSample.close();

      this.state.frameCount++;

      // Log progress periodically
      if (this.state.frameCount % 300 === 0) {
        const durationSec = (now - this.state.startTime) / 1000;
        const fps = this.state.frameCount / durationSec;
        log.info(
          `Recording progress: ${this.state.frameCount} frames, ${durationSec.toFixed(1)}s, ${fps.toFixed(1)} fps`
        );
      }
    } catch (err) {
      log.error('Error encoding frame:', err);
    }
  }

  /**
   * Stop recording and finalize the video file
   */
  async stopRecording(): Promise<string | null> {
    if (!this.state.isRecording) {
      log.warn('Not recording, ignoring stop request');
      return null;
    }

    const filePath = this.state.filePath;
    const frameCount = this.state.frameCount;
    const duration = (Date.now() - this.state.startTime) / 1000;

    log.info(
      `Stopping recording: ${frameCount} frames, ${duration.toFixed(1)}s`
    );

    try {
      // Finalize the output
      if (this.state.output) {
        await this.state.output.finalize();

        // Get the buffer and write to file
        const target = this.state.output.target as BufferTarget;
        if (target.buffer && filePath) {
          writeFileSync(filePath, Buffer.from(target.buffer));
          log.info(`Video file written: ${filePath}`);
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `[Observer Vault] Recording saved: ${filePath} (${frameCount} frames, ${duration.toFixed(1)}s)`
      );

      // Reset state
      this.state = {
        isRecording: false,
        filePath: null,
        output: null,
        videoSource: null,
        frameCount: 0,
        width: 0,
        height: 0,
        startTime: 0,
        lastFrameTime: 0,
        conversationId: '',
      };

      return filePath;
    } catch (err) {
      log.error('Error stopping recording:', err);
      return filePath;
    }
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.state.isRecording;
  }

  /**
   * Get the current recording file path
   */
  getCurrentFilePath(): string | null {
    return this.state.filePath;
  }

  /**
   * Get recording statistics
   */
  getStats(): { frameCount: number; duration: number; fps: number } | null {
    if (!this.state.isRecording) {
      return null;
    }

    const duration = (Date.now() - this.state.startTime) / 1000;
    const fps = duration > 0 ? this.state.frameCount / duration : 0;

    return {
      frameCount: this.state.frameCount,
      duration,
      fps,
    };
  }
}

// Export singleton instance
export const videoRecorder = new VideoRecorder();

// Export class for testing
export { VideoRecorder };
