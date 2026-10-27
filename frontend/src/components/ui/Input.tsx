'use client';

import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Подсказка под полем, пока ошибок нет */
  hint?: string;
  error?: string;
}

export default function Input({ label, hint, error, id, className = '', ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-body-sm font-medium text-charcoal">
          {label}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={`input ${error ? 'border-semantic-error' : ''} ${className}`.trim()}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-caption text-semantic-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-caption text-slate">{hint}</p>
      ) : null}
    </div>
  );
}
