'use client';

import { useEffect, useState } from 'react';

interface StepProps {
  onNext: () => void;
}

export default function StepProcessing({ onNext }: StepProps) {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Создаём твой профиль...');

  useEffect(() => {
    const messages = [
      'Создаём твой профиль...',
      'Подбираем книги под твой уровень...',
      'Настраиваем умные повторения...',
      'Готовим персональный план...',
    ];

    const interval = setInterval(() => {
      setProgress(prev => {
        const next = prev + 25;
        if (next >= 100) {
          clearInterval(interval);
          setTimeout(onNext, 500);
          return 100;
        }
        setMessage(messages[Math.floor(next / 25)]);
        return next;
      });
    }, 800);

    return () => clearInterval(interval);
  }, [onNext]);

  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex flex-col items-center justify-center p-6">
      {/* Анимация */}
      <div className="relative mb-12">
        <div className="w-32 h-32 bg-[var(--color-tint-mint)] rounded-full flex items-center justify-center">
          <span className="text-5xl animate-pulse">📚</span>
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 bg-[var(--color-tint-yellow-bold)] rounded-full animate-bounce"></div>
        <div className="absolute -bottom-2 -left-2 w-6 h-6 bg-[var(--color-primary)] rounded-full animate-bounce delay-100"></div>
      </div>

      {/* Прогресс */}
      <div className="w-64 mb-6">
        <div className="progress-bar h-3">
          <div className="progress-fill" style={{ width: `${progress}%` }}></div>
        </div>
      </div>

      {/* Текст */}
      <h2 className="text-xl font-semibold text-[var(--color-ink)] mb-2">
        {message}
      </h2>
      <p className="text-[var(--color-slate)] text-sm">
        Это займёт пару секунд
      </p>
    </div>
  );
}