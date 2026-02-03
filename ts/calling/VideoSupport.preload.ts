// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable max-classes-per-file */

// Observer Vault: videoPixelFormatToEnum unused (spawnSender removed)
// import { videoPixelFormatToEnum } from '@lockdown-systems/ringrtc';
import type { VideoFrameSender, VideoFrameSource } from '@lockdown-systems/ringrtc';
import type { RefObject } from 'react';
import { createLogger } from '../logging/log.std.js';
// Observer Vault: toLogFormat unused (startCapturing removed)
// import { toLogFormat } from '../types/errors.std.js';
import { callRecorder } from '../observervault/callRecorder.node.js';

const log = createLogger('VideoSupport');

export class GumVideoCaptureOptions {
  maxWidth = 640;
  maxHeight = 480;
  maxFramerate = 30;
  preferredDeviceId?: string;
  screenShareSourceId?: string;
  mediaStream?: MediaStream;
  onEnded?: () => void;
}

// Observer Vault: GumTrackConstraints unused (getUserMedia removed)
// interface GumTrackConstraints extends MediaTrackConstraints {
//   mandatory?: GumTrackConstraintSet;
// }

// type GumTrackConstraintSet = {
//   chromeMediaSource: string;
//   chromeMediaSourceId?: string;
//   maxWidth: number;
//   maxHeight: number;
//   minFrameRate: number;
//   maxFrameRate: number;
// };

export type SizeCallbackType = (options: {
  width: number;
  height: number;
}) => unknown;

export type SetLocalPreviewType = {
  localPreview: HTMLVideoElement | undefined;
  sizeCallback: SizeCallbackType | undefined;
};

export class GumVideoCapturer {
  private localPreview?: HTMLVideoElement;
  private sizeCallback?: SizeCallbackType;
  private captureOptions?: GumVideoCaptureOptions;
  // Observer Vault: sender, spawnedSenderRunning unused (video disabled)
  // private sender?: VideoFrameSender;
  private mediaStream?: MediaStream;
  // private spawnedSenderRunning = false;
  // private preferredDeviceId?: string;
  private reportVideoSizeCallback = this.reportVideoSize.bind(this);

  capturing(): boolean {
    return this.captureOptions !== undefined;
  }

  setLocalPreview(options: SetLocalPreviewType): void {
    const oldLocalPreview = this.localPreview;

    if (oldLocalPreview !== options.localPreview) {
      if (oldLocalPreview) {
        oldLocalPreview.srcObject = null;
        oldLocalPreview.removeEventListener(
          'resize',
          this.reportVideoSizeCallback
        );
      }

      this.localPreview = options.localPreview;

      if (this.localPreview) {
        this.localPreview.addEventListener(
          'resize',
          this.reportVideoSizeCallback
        );
      }
      this.updateLocalPreviewSourceObject();
    }

    this.sizeCallback = options.sizeCallback;
    this.reportVideoSize();
  }

  reportVideoSize(): void {
    if (!this.mediaStream || !this.sizeCallback) {
      return;
    }

    const settings = this.mediaStream.getVideoTracks()?.[0].getSettings();
    if (!settings?.width || !settings?.height) {
      return;
    }

    const size = {
      width: settings.width,
      height: settings.height,
    };
    this.sizeCallback(size);
  }

  async enableCapture(_options: GumVideoCaptureOptions): Promise<void> {
    // Observer Vault: Video capture is disabled - we don't use the camera
    log.info('GumVideoCapturer.enableCapture: disabled for Observer Vault');
    return Promise.resolve();
  }

  async enableCaptureAndSend(
    _sender: VideoFrameSender | undefined,
    _options: GumVideoCaptureOptions
  ): Promise<void> {
    // Observer Vault: Video capture is disabled - we don't use the camera
    log.info(
      'GumVideoCapturer.enableCaptureAndSend: disabled for Observer Vault'
    );
    return Promise.resolve();
  }

  disable(): void {
    this.stopCapturing();
    this.stopSending();
  }

  async setPreferredDevice(_deviceId: string): Promise<void> {
    // Observer Vault: Video capture is disabled - we don't use the camera
    log.info(
      'GumVideoCapturer.setPreferredDevice: disabled for Observer Vault'
    );
    return Promise.resolve();
  }

  async enumerateDevices(): Promise<Array<MediaDeviceInfo>> {
    // Observer Vault: Return empty array - we don't use cameras
    return [];
  }

  // Observer Vault: getUserMedia method removed (startCapturing removed)
  // The method was previously here but is not called since cameras are disabled.

  // Observer Vault: startCapturing method removed (camera disabled)
  // The method was previously here but is not called since cameras are disabled.

  private stopCapturing(): void {
    if (!this.capturing()) {
      log.warn('stopCapturing(): not capturing');
      return;
    }
    log.info('stopCapturing()');
    this.captureOptions = undefined;
    if (this.mediaStream) {
      for (const track of this.mediaStream.getVideoTracks()) {
        // Make the light turn off faster
        track.stop();
      }
      this.mediaStream = undefined;
    }

    this.updateLocalPreviewSourceObject();
  }

  // Observer Vault: startSending method removed (video sending disabled)
  // The method was previously here but is not called since video is disabled.

  // Observer Vault: spawnSender method removed (video sending disabled)
  // The method was previously here but is not called since video is disabled.

  private stopSending(): void {
    // Observer Vault: sender was removed, nothing to stop
    // The spawned sender should stop
    // this.sender = undefined;
  }

  private updateLocalPreviewSourceObject(): void {
    const { localPreview } = this;
    if (!localPreview) {
      log.warn('No local preview to update');
      return;
    }

    const { mediaStream = null } = this;

    if (localPreview.srcObject === mediaStream) {
      return;
    }

    if (mediaStream && this.captureOptions) {
      log.warn('Enabling local preview');
      localPreview.srcObject = mediaStream;
      if (localPreview.width === 0) {
        localPreview.width = this.captureOptions.maxWidth;
      }
      if (localPreview.height === 0) {
        localPreview.height = this.captureOptions.maxHeight;
      }
    } else {
      log.warn('Disabling local preview');
      localPreview.srcObject = null;
    }
  }
}

export const MAX_VIDEO_CAPTURE_WIDTH = 2880;
export const MAX_VIDEO_CAPTURE_HEIGHT = 1800;
export const MAX_VIDEO_CAPTURE_AREA =
  MAX_VIDEO_CAPTURE_WIDTH * MAX_VIDEO_CAPTURE_HEIGHT;
export const MAX_VIDEO_CAPTURE_BUFFER_SIZE = MAX_VIDEO_CAPTURE_AREA * 4;

export class CanvasVideoRenderer {
  private canvas?: RefObject<HTMLCanvasElement>;
  private sizeCallback?: SizeCallbackType;
  private buffer: Uint8Array;
  private imageData?: ImageData;
  private source?: VideoFrameSource;
  private rafId?: ReturnType<typeof requestAnimationFrame>;

  constructor() {
    this.buffer = new Uint8Array(MAX_VIDEO_CAPTURE_BUFFER_SIZE);
  }

  setCanvas(canvas: RefObject<HTMLCanvasElement> | undefined): void {
    this.canvas = canvas;
  }
  setSizer(callback: SizeCallbackType | undefined): void {
    this.sizeCallback = callback;

    if (this.imageData) {
      this.sizeCallback?.({
        width: this.imageData.width,
        height: this.imageData.height,
      });
    }
  }

  enable(source: VideoFrameSource): void {
    if (this.source === source) {
      return;
    }
    if (this.source) {
      // If we're replacing an existing source, make sure we stop the
      // current rAF loop before starting another one.
      if (this.rafId) {
        window.cancelAnimationFrame(this.rafId);
      }
    }
    this.source = source;
    this.requestAnimationFrameCallback();
  }

  disable(): void {
    this.renderBlack();
    this.source = undefined;
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
    }
  }

  private requestAnimationFrameCallback() {
    this.renderVideoFrame();
    this.rafId = window.requestAnimationFrame(
      this.requestAnimationFrameCallback.bind(this)
    );
  }

  private renderBlack() {
    if (!this.canvas) {
      return;
    }
    const canvas = this.canvas.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.fillStyle = 'black';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  private renderVideoFrame() {
    if (!this.source || !this.canvas) {
      return;
    }
    const canvas = this.canvas.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const frame = this.source.receiveVideoFrame(
      this.buffer,
      MAX_VIDEO_CAPTURE_WIDTH,
      MAX_VIDEO_CAPTURE_HEIGHT
    );
    if (!frame) {
      return;
    }
    const [width, height] = frame;

    if (
      width <= 2 ||
      height <= 2 ||
      width > MAX_VIDEO_CAPTURE_WIDTH ||
      height > MAX_VIDEO_CAPTURE_HEIGHT
    ) {
      return;
    }

    const frameAspectRatio = width / height;
    const canvasAspectRatio = canvas.clientWidth / canvas.clientHeight;

    let dx = 0;
    let dy = 0;

    if (frameAspectRatio > canvasAspectRatio) {
      // Frame wider than view: We need bars at the top and bottom
      canvas.width = width;
      canvas.height = width / canvasAspectRatio;
      dy = (canvas.height - height) / 2;
    } else if (frameAspectRatio < canvasAspectRatio) {
      // Frame narrower than view: We need pillars on the sides
      canvas.width = height * canvasAspectRatio;
      canvas.height = height;
      dx = (canvas.width - width) / 2;
    } else {
      // Will stretch perfectly with no bars
      canvas.width = width;
      canvas.height = height;
    }

    if (dx > 0 || dy > 0) {
      context.fillStyle = 'black';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    const sizeChanged =
      this.imageData?.width !== width || this.imageData?.height !== height;

    if (!this.imageData || sizeChanged) {
      this.imageData = new ImageData(width, height);
    }
    this.imageData.data.set(this.buffer.subarray(0, width * height * 4));
    context.putImageData(this.imageData, dx, dy);

    if (sizeChanged) {
      this.sizeCallback?.({ width, height });
    }

    // Observer Vault: Capture frame for recording if recording is active
    if (callRecorder.isRecording()) {
      // Create a copy of the buffer for the recorder (async operation)
      const frameData = this.buffer.slice(0, width * height * 4);
      void callRecorder.addFrame(frameData, width, height);
    }
  }
}
