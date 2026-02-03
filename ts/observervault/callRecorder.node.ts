// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Observer Vault Call Recorder
 *
 * Records incoming audio and video call frames to WebM files
 * using WebCodecs + mediabunny. No external dependencies like ffmpeg required.
 *
 * Features:
 * - Video recording via VideoSampleSource (VP9 codec)
 * - Audio recording via AudioSampleSource (Opus codec - raw PCM samples from RingRTC)
 * - Black frame generation when remote camera is off
 * - WebM output for both video and audio-only calls
 *
 * Note: We use WebM+Opus instead of MP4+AAC because AAC encoding is not
 * supported via WebCodecs on Linux/Chromium due to licensing restrictions.
 * Opus provides excellent audio quality and is universally supported.
 */

import {
  Output,
  WebMOutputFormat,
  BufferTarget,
  VideoSampleSource,
  VideoSample,
  AudioSampleSource,
  AudioSample,
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
// Portrait orientation since most users are on phones
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 640;
// Audio sample polling interval (10ms = 100Hz, faster than typical audio chunk sizes)
const AUDIO_POLL_INTERVAL_MS = 10;
// Audio buffer size: 48000 samples/sec * 0.1 sec = 4800 samples max per poll
const AUDIO_BUFFER_SIZE = 4800;

/**
 * Convert mono audio data to stereo by duplicating the channel
 * This is needed because some browsers (Linux/Chromium) don't support mono AAC encoding
 */
function monoToStereo(monoData: Int16Array): Int16Array {
  const stereoData = new Int16Array(monoData.length * 2);
  for (let i = 0; i < monoData.length; i += 1) {
    // Duplicate each sample to left and right channels
    stereoData[i * 2] = monoData[i]; // Left
    stereoData[i * 2 + 1] = monoData[i]; // Right
  }
  return stereoData;
}

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
  audioSource: AudioSampleSource | null;
  frameCount: number;
  audioSampleCount: number;
  width: number;
  height: number;
  startTime: number;
  lastFrameTime: number;
  conversationId: string;
  // Media state tracking
  hasEverHadVideo: boolean; // True if we ever received a real video frame
  currentlyHasVideo: boolean; // True if remote camera is currently on
  hasAudioEnabled: boolean; // True if audio capture is enabled
  audioSampleRate: number; // Sample rate from RingRTC (e.g., 48000)
  // Black frame timer
  blackFrameTimer: ReturnType<typeof setInterval> | null;
  // Audio polling timer
  audioPollTimer: ReturnType<typeof setInterval> | null;
  // Audio polling callback (set by calling code)
  audioPollCallback: (() => void) | null;
  // For audio calls: backup video+audio recording in case camera is enabled
  backupVideoOutput: Output | null;
  backupVideoSource: VideoSampleSource | null;
  backupAudioSource: AudioSampleSource | null;
  backupBlackFrameTimer: ReturnType<typeof setInterval> | null;
  isAudioCallWithBackup: boolean; // True if this is an audio call with backup video
};

class CallRecorder {
  private state: RecordingState = {
    isRecording: false,
    filenameBase: null,
    output: null,
    videoSource: null,
    audioSource: null,
    frameCount: 0,
    audioSampleCount: 0,
    width: 0,
    height: 0,
    startTime: 0,
    lastFrameTime: 0,
    conversationId: '',
    hasEverHadVideo: false,
    currentlyHasVideo: false,
    hasAudioEnabled: false,
    audioSampleRate: 48000, // Default, will be updated from RingRTC
    blackFrameTimer: null,
    audioPollTimer: null,
    audioPollCallback: null,
    backupVideoOutput: null,
    backupVideoSource: null,
    backupAudioSource: null,
    backupBlackFrameTimer: null,
    isAudioCallWithBackup: false,
  };

  // Shared audio buffer for polling from RingRTC
  private audioBuffer = new Int16Array(AUDIO_BUFFER_SIZE);

  /**
   * Start recording
   * @param conversationId - The conversation ID for the recording
   * @param enableAudio - Whether audio capture is enabled via RingRTC
   * @param isVideoCall - Whether this is a video call (affects encoder choice)
   * @param audioPollCallback - Callback to poll audio samples from RingRTC
   */
  async startRecording(
    conversationId: string,
    enableAudio = true,
    isVideoCall = true,
    audioPollCallback?: () => void
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
        frameCount: 0,
        audioSampleCount: 0,
        width: 0,
        height: 0,
        startTime: Date.now(),
        lastFrameTime: 0,
        conversationId,
        hasEverHadVideo: false,
        currentlyHasVideo: false,
        hasAudioEnabled: enableAudio,
        audioSampleRate: 48000,
        blackFrameTimer: null,
        audioPollTimer: null,
        audioPollCallback: audioPollCallback ?? null,
        backupVideoOutput: null,
        backupVideoSource: null,
        backupAudioSource: null,
        backupBlackFrameTimer: null,
        isAudioCallWithBackup: false,
      };

      // eslint-disable-next-line no-console
      console.log(`[Observer Vault] Recording started: ${filenameBasePath}`);
      if (enableAudio) {
        log.info('Audio capture enabled via RingRTC');
        // Start audio polling timer
        this.startAudioPollTimer();
      }

      // For audio-only calls, initialize the audio encoder immediately
      // AND start a backup video+audio encoder in case camera is enabled later
      if (!isVideoCall && enableAudio) {
        log.info('Audio-only call detected, initializing audio encoder now');
        const success = await this.initializeAudioOnlyEncoder();
        if (!success) {
          log.error('Failed to initialize audio encoder for audio-only call');
          this.resetState();
          return null;
        }

        // Also start a backup video+audio recording with black frames
        // in case the camera is enabled mid-call
        log.info('Starting backup video+audio recording for potential camera');
        await this.initializeBackupVideoRecording();
      }

      return filenameBasePath;
    } catch (err) {
      log.error('Failed to start recording:', err);
      return null;
    }
  }

  /**
   * Start the audio polling timer
   */
  private startAudioPollTimer(): void {
    if (this.state.audioPollTimer) {
      return;
    }

    this.state.audioPollTimer = setInterval(() => {
      if (this.state.audioPollCallback) {
        this.state.audioPollCallback();
      }
    }, AUDIO_POLL_INTERVAL_MS);

    log.info('Audio polling timer started');
  }

  /**
   * Stop the audio polling timer
   */
  private stopAudioPollTimer(): void {
    if (this.state.audioPollTimer) {
      clearInterval(this.state.audioPollTimer);
      this.state.audioPollTimer = null;
    }
  }

  /**
   * Get the audio buffer for RingRTC to write samples into
   */
  getAudioBuffer(): Int16Array {
    return this.audioBuffer;
  }

  /**
   * Add audio samples from RingRTC to the recording
   * @param samplesWritten - Number of samples written to the buffer
   * @param sampleRate - Sample rate from RingRTC
   */
  async addAudioSamples(
    samplesWritten: number,
    sampleRate: number
  ): Promise<void> {
    if (!this.state.isRecording || samplesWritten === 0) {
      return;
    }

    // Update sample rate if changed
    if (sampleRate !== this.state.audioSampleRate) {
      log.info(`Audio sample rate updated: ${sampleRate}`);
      this.state.audioSampleRate = sampleRate;
    }

    // Calculate timestamp in seconds
    const timestampSec = (Date.now() - this.state.startTime) / 1000;

    // Create audio sample from the buffer
    // RingRTC provides mono Int16 PCM data - convert to stereo for AAC encoding
    // (Some browsers like Chromium on Linux don't support mono AAC encoding)
    const monoData = this.audioBuffer.slice(0, samplesWritten);
    const stereoData = monoToStereo(monoData);

    try {
      // Add to main output if initialized
      if (this.state.audioSource) {
        const sample = new AudioSample({
          data: stereoData.buffer.slice(
            stereoData.byteOffset,
            stereoData.byteOffset + stereoData.byteLength
          ),
          format: 's16',
          numberOfChannels: 2, // Stereo (mono duplicated to both channels)
          sampleRate,
          timestamp: timestampSec,
        });
        await this.state.audioSource.add(sample);
        sample.close();
      }

      // Also add to backup output if it exists
      if (this.state.backupAudioSource) {
        const sample = new AudioSample({
          data: stereoData.buffer.slice(
            stereoData.byteOffset,
            stereoData.byteOffset + stereoData.byteLength
          ),
          format: 's16',
          numberOfChannels: 2,
          sampleRate,
          timestamp: timestampSec,
        });
        await this.state.backupAudioSource.add(sample);
        sample.close();
      }

      this.state.audioSampleCount += samplesWritten;
    } catch (err) {
      log.error('Error adding audio samples:', err);
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
      // Create video sample source with VP9 codec (WebM compatible)
      const videoSource = new VideoSampleSource({
        codec: 'vp9',
        bitrate: VIDEO_BITRATE,
        sizeChangeBehavior: 'contain',
      });

      // Create the output with WebM format (better codec support on Linux)
      const output = new Output({
        format: new WebMOutputFormat(),
        target: new BufferTarget(),
      });

      // Add the video track
      output.addVideoTrack(videoSource, { frameRate: TARGET_FPS });

      // If audio is enabled, add an audio track with Opus codec
      if (this.state.hasAudioEnabled) {
        const audioSource = new AudioSampleSource({
          codec: 'opus',
          bitrate: AUDIO_BITRATE,
        });
        output.addAudioTrack(audioSource);
        this.state.audioSource = audioSource;
        log.info('Added audio track to WebM output');
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
   * Initialize audio-only encoder (WebM with Opus audio)
   * Note: We use Opus because AAC encoding is not supported on Linux via WebCodecs
   */
  private async initializeAudioOnlyEncoder(): Promise<boolean> {
    if (this.state.output) {
      return true;
    }

    if (!this.state.hasAudioEnabled) {
      log.error('Cannot initialize audio-only encoder without audio enabled');
      return false;
    }

    log.info('Initializing audio-only encoder (WebM/Opus)');

    try {
      // Create audio source with Opus codec (universally supported on Linux)
      const audioSource = new AudioSampleSource({
        codec: 'opus',
        bitrate: AUDIO_BITRATE,
      });

      // Create the output with WebM format
      const output = new Output({
        format: new WebMOutputFormat(),
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
   * Initialize backup video+audio recording for audio calls
   * This runs in parallel with the audio-only recording in case camera is enabled
   */
  private async initializeBackupVideoRecording(): Promise<boolean> {
    if (!this.state.hasAudioEnabled) {
      log.error('Cannot initialize backup video without audio enabled');
      return false;
    }

    log.info('Initializing backup video+audio encoder with black frames');

    try {
      // Create video sample source with VP9 codec
      const videoSource = new VideoSampleSource({
        codec: 'vp9',
        bitrate: VIDEO_BITRATE,
        sizeChangeBehavior: 'contain',
      });

      // Create a SEPARATE audio source for the backup with Opus codec
      const audioSource = new AudioSampleSource({
        codec: 'opus',
        bitrate: AUDIO_BITRATE,
      });

      // Create the output with WebM format
      const output = new Output({
        format: new WebMOutputFormat(),
        target: new BufferTarget(),
      });

      // Add both tracks
      output.addVideoTrack(videoSource, { frameRate: TARGET_FPS });
      output.addAudioTrack(audioSource);

      // Start the output
      await output.start();

      this.state.backupVideoOutput = output;
      this.state.backupVideoSource = videoSource;
      this.state.backupAudioSource = audioSource;
      this.state.isAudioCallWithBackup = true;

      log.info('Backup video+audio encoder initialized successfully');

      // Start generating black frames for the backup
      this.startBackupBlackFrameTimer();

      return true;
    } catch (err) {
      log.error('Failed to initialize backup video encoder:', err);
      return false;
    }
  }

  /**
   * Start generating black frames for the backup video recording
   */
  private startBackupBlackFrameTimer(): void {
    if (this.state.backupBlackFrameTimer) {
      return; // Already running
    }

    const width = DEFAULT_WIDTH;
    const height = DEFAULT_HEIGHT;
    const blackFrame = generateBlackFrame(width, height);

    log.info('Starting black frame generation for backup video recording');

    this.state.backupBlackFrameTimer = setInterval(() => {
      if (this.state.backupVideoSource && !this.state.hasEverHadVideo) {
        void this.addFrameToBackup(blackFrame, width, height);
      }
    }, BLACK_FRAME_INTERVAL_MS);
  }

  /**
   * Stop backup black frame timer
   */
  private stopBackupBlackFrameTimer(): void {
    if (this.state.backupBlackFrameTimer) {
      clearInterval(this.state.backupBlackFrameTimer);
      this.state.backupBlackFrameTimer = null;
    }
  }

  /**
   * Add a frame to the backup video recording
   */
  private async addFrameToBackup(
    rgbaData: Uint8Array,
    width: number,
    height: number
  ): Promise<void> {
    if (!this.state.backupVideoSource) {
      return;
    }

    try {
      const timestampSec = (Date.now() - this.state.startTime) / 1000;

      const videoSample = new VideoSample(rgbaData, {
        format: 'RGBA',
        codedWidth: width,
        codedHeight: height,
        timestamp: timestampSec,
        duration: FRAME_DURATION_SEC,
      });

      await this.state.backupVideoSource.add(videoSample);
      videoSample.close();
    } catch (_err) {
      // Silently ignore errors for backup frames
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
      // Stop backup black frame timer - we have real video now
      this.stopBackupBlackFrameTimer();
    }

    // For audio calls with backup, when we receive real video,
    // add frames to the backup video recording instead of trying
    // to initialize the main audio-only output with video
    if (this.state.isAudioCallWithBackup && this.state.backupVideoSource) {
      // Send frame to backup recording
      await this.addFrameToBackup(rgbaData, width, height);
      this.state.frameCount += 1;
      return;
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

    // Stop timers
    this.stopBlackFrameTimer();
    this.stopAudioPollTimer();
    this.stopBackupBlackFrameTimer();

    const {
      filenameBase,
      frameCount,
      audioSampleCount,
      startTime,
      hasEverHadVideo,
      hasAudioEnabled,
    } = this.state;
    const duration = (Date.now() - startTime) / 1000;

    log.info(
      `Stopping recording: ${frameCount} frames, ${audioSampleCount} audio samples, ` +
        `${duration.toFixed(1)}s, hasVideo=${hasEverHadVideo}, hasAudio=${hasAudioEnabled}`
    );

    // For audio calls with backup: choose which recording to save
    if (this.state.isAudioCallWithBackup) {
      if (hasEverHadVideo && this.state.backupVideoOutput) {
        // Camera was enabled - save the video+audio backup, discard audio-only
        log.info(
          'Audio call had video enabled, saving video+audio backup recording'
        );

        const extension = '.webm';
        const filePath = filenameBase ? `${filenameBase}${extension}` : null;

        try {
          // Finalize the backup video output
          await this.state.backupVideoOutput.finalize();

          // Discard the primary audio-only output (don't finalize, just abandon)
          // The output will be garbage collected

          // Get the buffer and write to file
          const target = this.state.backupVideoOutput.target as BufferTarget;
          if (target.buffer && filePath) {
            writeFileSync(filePath, Buffer.from(target.buffer));
            log.info(`Recording saved: ${filePath}`);
          }

          // eslint-disable-next-line no-console
          console.log(
            `[Observer Vault] Recording saved: ${filePath} ` +
              `(${frameCount} frames, ${duration.toFixed(1)}s)`
          );

          this.resetState();
          return filePath;
        } catch (err) {
          log.error('Error stopping backup recording:', err);
          this.resetState();
          return filePath;
        }
      } else {
        // Camera was never enabled - save the audio-only, discard video backup
        log.info(
          'Audio call had no video, saving audio-only, discarding backup'
        );
        // The backup will be discarded when we reset state
        // Continue with normal audio-only finalization below
      }
    }

    // If we have audio but no video, and encoder wasn't initialized yet, do it now
    if (!this.state.output && hasAudioEnabled && !hasEverHadVideo) {
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
    // All recordings use WebM container (VP9 video + Opus audio)
    const extension = '.webm';
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
    this.stopAudioPollTimer();
    this.stopBackupBlackFrameTimer();
    this.state = {
      isRecording: false,
      filenameBase: null,
      output: null,
      videoSource: null,
      audioSource: null,
      frameCount: 0,
      audioSampleCount: 0,
      width: 0,
      height: 0,
      startTime: 0,
      lastFrameTime: 0,
      conversationId: '',
      hasEverHadVideo: false,
      currentlyHasVideo: false,
      hasAudioEnabled: false,
      audioSampleRate: 48000,
      blackFrameTimer: null,
      audioPollTimer: null,
      audioPollCallback: null,
      // Backup recording fields
      backupVideoOutput: null,
      backupVideoSource: null,
      backupAudioSource: null,
      backupBlackFrameTimer: null,
      isAudioCallWithBackup: false,
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
    audioSampleCount: number;
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
      audioSampleCount: this.state.audioSampleCount,
      duration,
      fps,
      hasVideo: this.state.hasEverHadVideo,
      hasAudio: this.state.hasAudioEnabled,
    };
  }
}

// Export singleton instance
export const callRecorder = new CallRecorder();

// Export class for testing
export { CallRecorder };

// Legacy export for backward compatibility during migration
export const videoRecorder = callRecorder;
