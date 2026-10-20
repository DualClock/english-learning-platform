'use client';

import { useRef, useState } from 'react';
import { API_URL } from '@/app/lib/api-url';
import { DEFAULT_AVATARS, resolveAvatarSrc } from '@/app/lib/avatars';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface AvatarPickerProps {
  token: string;
  onDone: (avatarUrl: string) => void;
  onSkip?: () => void;
}

export default function AvatarPicker({ token, onDone, onSkip }: AvatarPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const chooseDefault = async (name: string) => {
    setError('');
    setIsUploading(true);
    try {
      const res = await fetch(`${API_URL}/api/profile/avatar/default`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      onDone(data.avatarUrl);
    } catch {
      setError('Не удалось сохранить аватар. Попробуйте ещё раз.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    setError('');
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Поддерживаются только JPG, PNG и WEBP');
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setError('Файл слишком большой. Максимум 2 МБ');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/api/profile/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `status ${res.status}`);
      }
      const data = await res.json();
      onDone(data.avatarUrl);
    } catch (err) {
      setError(err instanceof Error && !err.message.startsWith('status') ? err.message : 'Не удалось загрузить аватар. Попробуйте ещё раз.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-5 gap-3 mb-5 stagger">
        {DEFAULT_AVATARS.map((name) => (
          <button
            key={name}
            onClick={() => chooseDefault(name)}
            disabled={isUploading}
            aria-label={`Выбрать аватар ${name}`}
            className="rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] disabled:opacity-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolveAvatarSrc(`/avatars/${name}.svg`)} alt="" className="w-full h-auto rounded-full" />
          </button>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="w-full py-3 rounded-lg border-2 border-dashed border-[var(--color-hairline-strong)] text-[var(--color-ink)] font-medium hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors disabled:opacity-50"
      >
        {isUploading ? 'Загружаем…' : 'Загрузить свою'}
      </button>

      {error && (
        <p className="mt-3 text-sm text-[var(--color-error)] text-center">{error}</p>
      )}

      {onSkip && (
        <button onClick={onSkip} className="mt-4 w-full text-[var(--color-slate)] hover:text-[var(--color-ink)]">
          Пропустить
        </button>
      )}
    </div>
  );
}
