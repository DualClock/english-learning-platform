'use client';

import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { DEFAULT_AVATARS, resolveAvatarSrc } from '@/app/lib/avatars';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface AvatarPickerProps {
  /** Текущий аватар профиля — чтобы выбор не выглядел как сетка одинаковых кнопок. */
  current?: string | null;
  onDone: (avatarUrl: string) => void;
  onSkip?: () => void;
}

export default function AvatarPicker({ current, onDone, onSkip }: AvatarPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const chooseDefault = async (name: string) => {
    setError('');
    setIsUploading(true);
    try {
      const res = await fetch(`/api/next/profile/avatar/default`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
      const res = await fetch(`/api/next/profile/avatar`, {
        method: 'POST',
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
      <div
        className="stagger mb-5 grid grid-cols-5 gap-3"
        role="group"
        aria-label="Готовые аватары"
      >
        {DEFAULT_AVATARS.map((name) => {
          const src = resolveAvatarSrc(`/avatars/${name}.svg`);
          const isCurrent = Boolean(current) && resolveAvatarSrc(current) === src;
          return (
            <button
              key={name}
              type="button"
              onClick={() => chooseDefault(name)}
              disabled={isUploading}
              aria-current={isCurrent || undefined}
              aria-label={`Выбрать аватар ${name}`}
              className={`rounded-full transition-transform duration-fast ease-soft hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 ${
                isCurrent ? 'ring-2 ring-navy' : ''
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="aspect-square w-full rounded-full" />
            </button>
          );
        })}
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

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          {isUploading ? 'Загружаем…' : 'Загрузить своё'}
        </Button>
        <span className="text-caption text-slate">JPG, PNG или WEBP до 2 МБ</span>
      </div>

      {/* Живой регион смонтирован заранее: сообщение появляется не на пустом месте. */}
      <p role="alert" className={error ? 'mt-3 text-body-sm text-semantic-error' : 'sr-only'}>
        {error}
      </p>

      {onSkip && (
        <Button variant="ghost" className="mt-4 w-full" onClick={onSkip}>
          Пропустить
        </Button>
      )}
    </div>
  );
}
