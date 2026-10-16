'use client';

import { useState } from 'react';

const GRADIENTS = [
  'bg-gradient-to-br from-[#DDE7DE] to-[#B4C8B7] text-[#2C5540]',
  'bg-gradient-to-br from-[#F3E3B6] to-[#E2C67E] text-[#7A5F1E]',
  'bg-gradient-to-br from-[#EBDCC5] to-[#C4A77D] text-[#5F4426]',
];

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface BookCoverProps {
  title: string;
  coverUrl?: string;
  className?: string;
  size?: 'sm' | 'lg';
}

export default function BookCover({ title, coverUrl, className = '', size = 'lg' }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  const words = title.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  const gradient = GRADIENTS[hashString(title) % GRADIENTS.length];

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {coverUrl && !failed ? (
        <img
          src={coverUrl}
          alt={title}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className={`absolute inset-0 flex items-center justify-center font-bold ${gradient}`}>
          <span className={size === 'sm' ? 'text-xl' : 'text-4xl md:text-5xl'}>
            {initials || '?'}
          </span>
        </div>
      )}
    </div>
  );
}
