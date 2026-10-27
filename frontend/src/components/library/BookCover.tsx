'use client';

import { useState } from 'react';

interface BookCoverProps {
  title: string;
  coverUrl?: string;
  className?: string;
  size?: 'sm' | 'lg';
}

/**
 * Обложка книги: настоящая картинка, а пока её нет — спокойная тон-плитка
 * с инициалами. Градиентных «заглушек» здесь сознательно нет.
 */
export default function BookCover({ title, coverUrl, className = '', size = 'lg' }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  const initials = title
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-md border border-hairline bg-surface ${className}`.trim()}
    >
      {coverUrl && !failed ? (
        <img
          src={coverUrl}
          alt={title}
          onError={() => setFailed(true)}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center font-heading font-semibold text-primary">
          <span className={size === 'sm' ? 'text-h3' : 'text-h2'}>{initials || '?'}</span>
        </span>
      )}
    </div>
  );
}
