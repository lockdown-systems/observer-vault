// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, {
  type ReactElement,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';

import { Button, ButtonVariant } from '../Button.dom.js';
import { TitlebarDragArea } from '../TitlebarDragArea.dom.js';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.js';

const CODE_LENGTH = 6;

export type Props = Readonly<{
  phoneNumber: string;
  onSubmitCode: (code: string) => void;
  onResendCode: () => void;
  onBack: () => void;
  isSubmitting: boolean;
  error?: string;
}>;

export function InstallScreenVerificationCodeStep({
  phoneNumber,
  onSubmitCode,
  onResendCode,
  onBack,
  isSubmitting,
  error,
}: Props): ReactElement {
  const [code, setCode] = useState('');
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = useCallback(
    (index: number, value: string) => {
      // Only allow digits
      const digit = value.replace(/\D/g, '').slice(-1);

      const newCode = code.split('');
      newCode[index] = digit;
      const updatedCode = newCode.join('').slice(0, CODE_LENGTH);
      setCode(updatedCode);

      // Move to next input if we entered a digit
      if (digit && index < CODE_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Auto-submit when complete
      if (updatedCode.length === CODE_LENGTH) {
        onSubmitCode(updatedCode);
      }
    },
    [code, onSubmitCode]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !code[index] && index > 0) {
        // Move to previous input on backspace if current is empty
        inputRefs.current[index - 1]?.focus();
      }
    },
    [code]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pastedText = e.clipboardData.getData('text');
      const digits = pastedText.replace(/\D/g, '').slice(0, CODE_LENGTH);
      setCode(digits);

      // Focus the input after the last pasted digit
      const nextIndex = Math.min(digits.length, CODE_LENGTH - 1);
      inputRefs.current[nextIndex]?.focus();

      // Auto-submit if we pasted a complete code
      if (digits.length === CODE_LENGTH) {
        onSubmitCode(digits);
      }
    },
    [onSubmitCode]
  );

  return (
    <div className="module-InstallScreenVerificationCodeStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <div className="module-InstallScreenVerificationCodeStep__card">
        <h1 className="module-InstallScreenVerificationCodeStep__title">
          Enter verification code
        </h1>
        <p className="module-InstallScreenVerificationCodeStep__description">
          We sent a code to <strong>{phoneNumber}</strong>
        </p>

        {error && (
          <div className="module-InstallScreenVerificationCodeStep__error">
            {error}
          </div>
        )}

        <div
          className="module-InstallScreenVerificationCodeStep__code-inputs"
          onPaste={handlePaste}
        >
          {Array.from({ length: CODE_LENGTH }).map((_, index) => (
            <input
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              ref={el => {
                inputRefs.current[index] = el;
              }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              className="module-InstallScreenVerificationCodeStep__code-input"
              value={code[index] || ''}
              onChange={e => handleChange(index, e.target.value)}
              onKeyDown={e => handleKeyDown(index, e)}
              disabled={isSubmitting}
            />
          ))}
        </div>

        <div className="module-InstallScreenVerificationCodeStep__buttons">
          <Button
            onClick={onResendCode}
            variant={ButtonVariant.Secondary}
            disabled={isSubmitting}
          >
            Resend code
          </Button>
          <Button
            onClick={onBack}
            variant={ButtonVariant.Secondary}
            disabled={isSubmitting}
          >
            Back
          </Button>
        </div>

        {isSubmitting && (
          <p className="module-InstallScreenVerificationCodeStep__status">
            Verifying...
          </p>
        )}
      </div>
    </div>
  );
}
