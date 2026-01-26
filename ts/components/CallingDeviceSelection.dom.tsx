// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';
import type { AudioDevice } from '@signalapp/ringrtc';

import type { Option } from './Select.dom.js';
import { Modal } from './Modal.dom.js';
import { Select } from './Select.dom.js';
import type { LocalizerType } from '../types/Util.std.js';
import type {
  ChangeIODevicePayloadType,
  MediaDeviceSettings,
} from '../types/Calling.std.js';
import { CallingDeviceType } from '../types/Calling.std.js';
import { Theme } from '../util/theme.std.js';

export type Props = MediaDeviceSettings & {
  changeIODevice: (payload: ChangeIODevicePayloadType) => void;
  i18n: LocalizerType;
  toggleSettings: () => void;
};

function localizeDefault(i18n: LocalizerType, deviceLabel: string): string {
  return deviceLabel.toLowerCase().startsWith('default')
    ? deviceLabel.replace(
        /default/i,
        i18n('icu:callingDeviceSelection__select--default')
      )
    : deviceLabel;
}

function renderAudioOptions(
  devices: Array<AudioDevice>,
  i18n: LocalizerType
): Array<Option> {
  if (!devices.length) {
    return [
      {
        text: i18n('icu:callingDeviceSelection__select--no-device'),
        value: '',
      },
    ];
  }

  return devices.map(device => {
    return {
      text: localizeDefault(i18n, device.name),
      value: device.index,
    };
  });
}

// Observer Vault: Camera selection removed, renderVideoOptions function removed
// function _renderVideoOptions(...) { ... }

function createAudioChangeHandler(
  devices: Array<AudioDevice>,
  changeIODevice: (payload: ChangeIODevicePayloadType) => void,
  type: CallingDeviceType.SPEAKER | CallingDeviceType.MICROPHONE
) {
  return (value: string): void => {
    changeIODevice({
      type,
      selectedDevice: devices[Number(value)],
    });
  };
}

// Observer Vault: Camera selection removed, createCameraChangeHandler function removed
// function _createCameraChangeHandler(...) { ... }

export function CallingDeviceSelection({
  availableCameras: _availableCameras,
  availableMicrophones: _availableMicrophones,
  availableSpeakers,
  changeIODevice,
  i18n,
  selectedCamera: _selectedCamera,
  selectedMicrophone,
  selectedSpeaker,
  toggleSettings,
}: Props): React.JSX.Element {
  // Observer Vault: Microphone selection UI removed, this variable is unused
  const _unusedSelectedMicrophoneIndex = selectedMicrophone
    ? selectedMicrophone.index
    : undefined;
  void _unusedSelectedMicrophoneIndex;
  const selectedSpeakerIndex = selectedSpeaker
    ? selectedSpeaker.index
    : undefined;

  return (
    <Modal
      modalName="CallingDeviceSelection"
      i18n={i18n}
      theme={Theme.Dark}
      onClose={toggleSettings}
    >
      <div className="module-calling-device-selection">
        <button
          type="button"
          className="module-calling-device-selection__close-button"
          onClick={toggleSettings}
          tabIndex={0}
          aria-label={i18n('icu:close')}
        />
      </div>

      <h1 className="module-calling-device-selection__title">
        {i18n('icu:callingDeviceSelection__settings')}
      </h1>

      {/* Observer Vault: Camera and microphone dropdowns removed - we don't use them */}

      <label
        htmlFor="audio-output"
        className="module-calling-device-selection__label"
      >
        {i18n('icu:callingDeviceSelection__label--audio-output')}
      </label>
      <div className="module-calling-device-selection__select">
        <Select
          disabled={!availableSpeakers.length}
          id="audio-output"
          name="audio-output"
          onChange={createAudioChangeHandler(
            availableSpeakers,
            changeIODevice,
            CallingDeviceType.SPEAKER
          )}
          options={renderAudioOptions(availableSpeakers, i18n)}
          value={selectedSpeakerIndex}
        />
      </div>
    </Modal>
  );
}
