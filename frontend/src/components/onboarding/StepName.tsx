'use client';

import { useState } from 'react';

interface StepProps {
  onNext: (data: { name: string }) => void;
  onBack: () => void;
}

export default function StepName({ onNext, onBack }: StepProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleNext = () => {
    if (name.trim().length < 2) {
      setError('Введи имя (минимум 2 символа)');
      return;
    }
    onNext({ name: name.trim() });
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex flex-col p-6">
      {/* Прогресс */}
      <div className="w-full max-w-md mx-auto mb-8">
        <div className="flex justify-between text-sm text-[var(--color-slate)] mb-2">
          <span>Шаг 1 из 6</span>
          <span>Как тебя зовут?</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '16%' }}></div>
        </div>
      </div>

      {/* Контент */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        <h2 className="text-2xl font-bold text-[var(--color-ink)] text-center mb-2">
          Привет! 👋
        </h2>
        <p className="text-[var(--color-slate)] text-center mb-8">
          Как тебя зовут? Мы будем обращаться к тебе по имени
        </p>

        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          placeholder="Твоё имя"
          className="input text-center text-lg py-4 mb-4"
          autoFocus
          onKeyPress={(e) => e.key === 'Enter' && handleNext()}
        />

        {error && (
          <p className="text-[var(--color-error)] text-sm mb-4">{error}</p>
        )}

        <button
          onClick={handleNext}
          disabled={name.trim().length < 2}
          className="btn-primary w-full py-4"
        >
          Продолжить
        </button>
      </div>

      {/* Назад */}
      <button onClick={onBack} className="text-[var(--color-slate)] hover:text-[var(--color-ink)] mx-auto">
        ← Назад
      </button>
    </div>
  );
}