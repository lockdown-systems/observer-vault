// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Observer Vault Call Recorder
 *
 * Records incoming audio and video call frames to MP4 or MP3 files
 * using WebCodecs + mediabunny. No external dependencies like ffmpeg required.
 *
 * Features:
 * - Video recording via VideoSampleSource
 * - Audio recording via MediaStreamAudioTrackSource (electron-audio-loopback)
 * - Black frame generation when remote camera is off
 * - MP4 output for video calls (with audio)
 * - MP3 output for audio-only calls
 */

import {
  Output,
  Mp4OutputFormat,
  Mp3OutputFormat,
  BufferTarget,
  VideoSampleSource,
  VideoSample,
  MediaStreamAudioTrackSource,
} from 'mediabunny';
import { join } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createLogger } from '../logging/log.std.js';

const log = createLogger('ObserverVault.CallRecorder');

// Recording configuration
const TARGET_FPS = 30;
const FRAME_DURATION_SEC = 1 / TARGET_FPS;
const BLACK_FRAME_INTERVAL_MS = 1000 / TARGET_FPS; // ~33ms for 30fps
// High bitrate for max quality: 10 Mbps (good for 1080p)
const VIDEO_BITRATE = 10_000_000;
// Audio bitrate: 128 kbps (good quality for voice)
const AUDIO_BITRATE = 128_000;
// Default dimensions for black frames when we haven't received any video yet
const DEFAULT_WIDTH = 640;
const DEFAULT_HEIGHT = 480;

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

// Generate a timestamped filename (extension added later based on content)
function generateFilenameBase(conversationId: string): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, -5);
  const sanitizedConvId = conversationId.slice(0, 8);
  return `call_${timestamp}_${sanitizedConvId}`;
}

// Generate a black frame of the given dimensions
function generateBlackFrame(width: number, height: number): Uint8Array {
  // RGBA format: 4 bytes per pixel, all zeros for RGB (black) and 255 for alpha
  const frameSize = width * height * 4;
  const blackFrame = new Uint8Array(frameSize);
  for (let i = 0; i < frameSize; i += 4) {
    blackFrame[i] = 0; // R
    blackFrame[i + 1] = 0; // G
    blackFrame[i + 2] = 0; // B
    blackFrame[i + 3] = 255; // A (fully opaque)
  }
  return blackFrame;
}

type RecordingState = {
  isRecording: boolean;
  filenameBase: string | null;
  output: Output | null;
  videoSource: VideoSampleSource | null;
  audioSource: MediaStreamAudioTrackSource | null;
  audioTrack: MediaStreamAudioTrack | null;
  frameCount: number;
  width: number;
  height: number;
  startTime: number;
  lastFrameTime: number;
  conversationId: string;
  // Media state tracking
  hasEverHadVideo: boolean; // True if we ever received a real video frame
  currentlyHasVideo: boolean; // True if remote camera is currently on
  hasAudioTrack: boolean; // True if we have an audio track connected
  // Black frame timer
  blackFrameTimer: ReturnType<typeof setInterval> | null;
};

class CallRecorder {
  private state: RecordingState = {
    isRecording: false,
    filenameBase: null,
    output: null,
    videoSource: null,
    audioSource: null,
    audioTrack: null,
    frameCount: 0,
    width: 0,
    height: 0,
    startTime: 0,
    lastFrameTime: 0,
    conversationId: '',
    hasEverHadVideo: false,
    currentlyHasVideo: false,
    hasAudioTrack: false,
    blackFrameTimer: null,
  };

  /**
   * Start recording
   * @param conversationId - The conversation ID for the recording
   * @param audioTrack - Optional audio track to include (from loopback audio)
   */
  async startRecording(
    conversationId: string,
    audioTrack?: MediaStreamAudioTrack
  ): Promise<string | null> {
    if (this.state.isRecording) {
      log.warn('Already recording, ignoring start request');
      return this.state.filenameBase;
    }

    // Check if WebCodecs is available
    if (typeof VideoEncoder === 'undefined') {
      log.error('WebCodecs VideoEncoder not available');
      return null;
    }

    const recordingsDir = getRecordingsDirectory();
    const filenameBase = generateFilenameBase(conversationId);
    const filenameBasePath = join(recordingsDir, filenameBase);

    log.info(`Starting recording with base filename: ${filenameBasePath}`);

    try {
      this.state = {
        isRecording: true,
        filenameBase: filenameBasePath,
        output: null,
        videoSource: null,
        audioSource: null,
        audioTrack: audioTrack ?? null,
        frameCount: 0,
        width: 0,
        height: 0,
        startTime: Date.now(),
        lastFrameTime: 0,
        conversationId,
        hasEverHadVideo: false,
        currentlyHasVideo: false,
        hasAudioTrack: audioTrack != null,
        blackFrameTimer: null,
      };

      // eslint-disable-next-line no-console
      console.log(`[Observer Vault] Recording started: ${filenameBasePath}`);
      if (audioTrack) {
        log.info('Audio track provided at recording start');
      }

      return filenameBasePath;
    } catch (err) {
      log.error('Failed to start recording:', err);
      return null;
    }
  }

  /**
   * Update the remote video state (camera on/off)
   * When camera is off, we generate black frames to maintain a consistent video track
   */
  updateRemoteVideoState(hasVideo: boolean): void {
    if (!this.state.isRecording) {
      return;
    }

    const wasHavingVideo = this.state.currentlyHasVideo;
    this.state.currentlyHasVideo = hasVideo;

    if (hasVideo && !wasHavingVideo) {
      // Camera turned on
      log.info('Remote camera turned ON, stopping black frame generation');
      this.stopBlackFrameTimer();
    } else if (!hasVideo && wasHavingVideo) {
      // Camera turned off
      log.info('Remote camera turned OFF, starting black frame generation');
      this.startBlackFrameTimer();
    }
  }

  /**
   * Start generating black frames at 30fps
   */
  private startBlackFrameTimer(): void {
    if (this.state.blackFrameTimer) {
      return; // Already running
    }

    // Only generate black frames if we have ever had video
    // (otherwise we'll create an audio-only output)
    if (!this.state.hasEverHadVideo) {
      return;
    }

    const width = this.state.width || DEFAULT_WIDTH;
    const height = this.state.height || DEFAULT_HEIGHT;
    const blackFrame = generateBlackFrame(width, height);

    this.state.blackFrameTimer = setInterval(() => {
      if (this.state.isRecording && !this.state.currentlyHasVideo) {
        void this.addFrame(blackFrame, width, height, true);
      }
    }, BLACK_FRAME_INTERVAL_MS);
  }

  /**
   * Stop generating black frames
   */
  private stopBlackFrameTimer(): void {
    if (this.state.blackFrameTimer) {
      clearInterval(this.state.blackFrameTimer);
      this.state.blackFrameTimer = null;
    }
  }

  /**
   * Initialize encoder with video and optionally audio
   */
  private async initializeVideoEncoder(
    width: number,
    height: number
  ): Promise<boolean> {
    if (this.state.output) {
      return true;
    }

    log.info(`Initializing video encoder for ${width}x${height}`);

    try {
      // Create video sample source
      const videoSource = new VideoSampleSource({
        codec: 'avc', // H.264
        bitrate: VIDEO_BITRATE,
        sizeChangeBehavior: 'contain',
      });

      // Create the output with MP4 format
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      // Add the video track
      output.addVideoTrack(videoSource, { frameRate: TARGET_FPS });

      // If we have an audio track, add it
      if (this.state.audioTrack) {
        const audioSource = new MediaStreamAudioTrackSource(
          this.state.audioTrack,
          {
            codec: 'aac',
            bitrate: AUDIO_BITRATE,
          }
        );
        output.addAudioTrack(audioSource);
        this.state.audioSource = audioSource;
        log.info('Added audio track to MP4 output');
      }

      // Start the output
      await output.start();

      this.state.output = output;
      this.state.videoSource = videoSource;
      this.state.width = width;
      this.state.height = height;

      log.info('Video encoder initialized successfully');
      return true;
    } catch (err) {
      log.error('Failed to initialize video encoder:', err);
      return false;
    }
  }

  /**
   * Initialize audio-only encoder (MP3)
   */
  private async initializeAudioOnlyEncoder(): Promise<boolean> {
    if (this.state.output) {
      return true;
    }

    if (!this.state.audioTrack) {
      log.error('Cannot initialize audio-only encoder without audio track');
      return false;
    }

    log.info('Initializing audio-only encoder (MP3)');

    try {
      // Create audio source
      const audioSource = new MediaStreamAudioTrackSource(
        this.state.audioTrack,
        {
          codec: 'mp3',
          bitrate: AUDIO_BITRATE,
        }
      );

      // Create the output with MP3 format
      const output = new Output({
        format: new Mp3OutputFormat(),
        target: new BufferTarget(),
      });

      // Add the audio track
      output.addAudioTrack(audioSource);

      // Start the output
      await output.start();

      this.state.output = output;
      this.state.audioSource = audioSource;

      log.info('Audio-only encoder initialized successfully');
      return true;
    } catch (err) {
      log.error('Failed to initialize audio-only encoder:', err);
      return false;
    }
  }

  /**
   * Add a video frame to the recording
   * @param rgbaData - Raw RGBA pixel data
   * @param width - Frame width
   * @param height - Frame height
   * @param isBlackFrame - Whether this is a generated black frame (for logging)
   */
  async addFrame(
    rgbaData: Uint8Array,
    width: number,
    height: number,
    isBlackFrame = false
  ): Promise<void> {
    if (!this.state.isRecording) {
      return;
    }

    // Track that we've received real video
    if (!isBlackFrame) {
      this.state.hasEverHadVideo = true;
      this.state.currentlyHasVideo = true;
      // Stop black frame timer if it was running
      this.stopBlackFrameTimer();
    }

    // Initialize encoder on first frame with actual dimensions
    if (!this.state.output) {
      const success = await this.initializeVideoEncoder(width, height);
      if (!success) {
        log.error('Failed to initialize encoder, stopping recording');
        await this.stopRecording();
        return;
      }
    }

    // Log dimension changes (mediabunny handles letterboxing)
    if (
      !isBlackFrame &&
      (width !== this.state.width || height !== this.state.height)
    ) {
      log.info(
        `Frame dimensions changed from ${this.state.width}x${this.state.height} to ${width}x${height}`
      );
    }

    try {
      // Calculate timestamp in seconds
      const now = Date.now();
      const timestampSec = (now - this.state.startTime) / 1000;

      // Rate limiting - skip frames if we're getting too many
      const minFrameInterval = 1000 / TARGET_FPS;
      if (
        this.state.lastFrameTime > 0 &&
        now - this.state.lastFrameTime < minFrameInterval * 0.5
      ) {
        return; // Skip this frame
      }
      this.state.lastFrameTime = now;

      // Create VideoSample from RGBA data
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

      this.state.frameCount += 1;

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
   * Stop recording and finalize the output file
   */
  async stopRecording(): Promise<string | null> {
    if (!this.state.isRecording) {
      log.warn('Not recording, ignoring stop request');
      return null;
    }

    // Stop black frame generation
    this.stopBlackFrameTimer();

    const {
      filenameBase,
      frameCount,
      startTime,
      hasEverHadVideo,
      hasAudioTrack,
    } = this.state;
    const duration = (Date.now() - startTime) / 1000;

    log.info(
      `Stopping recording: ${frameCount} frames, ${duration.toFixed(1)}s, hasVideo=${hasEverHadVideo}, hasAudio=${hasAudioTrack}`
    );

    // If we have audio but no video, and encoder wasn't initialized yet, do it now
    if (!this.state.output && hasAudioTrack && !hasEverHadVideo) {
      const success = await this.initializeAudioOnlyEncoder();
      if (!success) {
        log.error('Failed to initialize audio-only encoder');
        this.resetState();
        return null;
      }
    }

    // If we have no output at all (no video and no audio), nothing to save
    if (!this.state.output) {
      log.warn('No media was recorded, nothing to save');
      this.resetState();
      return null;
    }

    // Determine file extension based on content
    const extension = hasEverHadVideo ? '.mp4' : '.mp3';
    const filePath = filenameBase ? `${filenameBase}${extension}` : null;

    try {
      // Finalize the output
      await this.state.output.finalize();

      // Get the buffer and write to file
      const target = this.state.output.target as BufferTarget;
      if (target.buffer && filePath) {
        writeFileSync(filePath, Buffer.from(target.buffer));
        log.info(`Recording saved: ${filePath}`);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[Observer Vault] Recording saved: ${filePath} (${frameCount} frames, ${duration.toFixed(1)}s)`
      );

      this.resetState();
      return filePath;
    } catch (err) {
      log.error('Error stopping recording:', err);
      this.resetState();
      return filePath;
    }
  }

  /**
   * Reset state to initial values
   */
  private resetState(): void {
    this.stopBlackFrameTimer();
    this.state = {
      isRecording: false,
      filenameBase: null,
      output: null,
      videoSource: null,
      audioSource: null,
      audioTrack: null,
      frameCount: 0,
      width: 0,
      height: 0,
      startTime: 0,
      lastFrameTime: 0,
      conversationId: '',
      hasEverHadVideo: false,
      currentlyHasVideo: false,
      hasAudioTrack: false,
      blackFrameTimer: null,
    };
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.state.isRecording;
  }

  /**
   * Get the current recording file path (base, without extension)
   */
  getCurrentFilePath(): string | null {
    return this.state.filenameBase;
  }

  /**
   * Get recording statistics
   */
  getStats(): {
    frameCount: number;
    duration: number;
    fps: number;
    hasVideo: boolean;
    hasAudio: boolean;
  } | null {
    if (!this.state.isRecording) {
      return null;
    }

    const duration = (Date.now() - this.state.startTime) / 1000;
    const fps = duration > 0 ? this.state.frameCount / duration : 0;

    return {
      frameCount: this.state.frameCount,
      duration,
      fps,
      hasVideo: this.state.hasEverHadVideo,
      hasAudio: this.state.hasAudioTrack,
    };
  }
}

// Export singleton instance
export const callRecorder = new CallRecorder();

// Export class for testing
export { CallRecorder };

// Legacy export for backward compatibility during migration
export const videoRecorder = callRecorder;
