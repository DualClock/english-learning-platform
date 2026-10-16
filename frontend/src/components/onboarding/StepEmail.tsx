'use client';

import { useState } from 'react';

interface StepProps {
  onNext: (data: { email: string; notifications: boolean }) => void;
  onBack: () => void;
}

export default function StepEmail({ onNext, onBack }: StepProps) {
  const [email, setEmail] = useState('');
  const [notifications, setNotifications] = useState(true);
  const [error, setError] = useState('');

  const handleNext = () => {
    if (!email.includes('@') || !email.includes('.')) {
      setError('Введи корректный email');
      return;
    }
    onNext({ email, notifications });
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex flex-col p-6">
      {/* Прогресс */}
      <div className="w-full max-w-md mx-auto mb-8">
        <div className="flex justify-between text-sm text-[var(--color-slate)] mb-2">
          <span>Шаг 2 из 6</span>
          <span>Твой email</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '33%' }}></div>
        </div>
      </div>

      {/* Контент */}
      <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        <h2 className="text-2xl font-bold text-[var(--color-ink)] text-center mb-2">
          Где тебе удобно учиться? 📧
        </h2>
        <p className="text-[var(--color-slate)] text-center mb-8">
          Мы отправим подборку книг под твой уровень
        </p>

        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          placeholder="email@example.com"
          className="input text-center text-lg py-4 mb-4"
          autoFocus
          onKeyPress={(e) => e.key === 'Enter' && handleNext()}
        />

        {error && (
          <p className="text-[var(--color-error)] text-sm mb-4">{error}</p>
        )}

        {/* Согласие на уведомления */}
        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="mt-1 w-5 h-5 rounded border-[var(--color-hairline-strong)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
          />
          <span className="text-sm text-[var(--color-slate)]">
            Присылать напоминания о повторении и новые книги под мой уровень. 
            Никакого спама, только полезное.
          </span>
        </label>

        <button
          onClick={handleNext}
          disabled={!email.includes('@')}
          className="btn-primary w-full py-4"
        >
          Продолжить
        </button>
      </div>

      <button onClick={onBack} className="text-[var(--color-slate)] hover:text-[var(--color-ink)] mx-auto">
        ← Назад
      </button>
    </div>
  );
}