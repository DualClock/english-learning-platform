'use client';

import { useState } from 'react';

interface StepProps {
  onNext: (data: { password: string }) => void;
  onBack: () => void;
}

export default function StepPassword({ onNext, onBack }: StepProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const handleNext = () => {
    if (password.length < 6) {
      setError('Пароль должен быть минимум 6 символов');
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    onNext({ password });
  };

  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
      <div className="w-full max-w-md mx-auto mb-8">
        <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
          <span>Шаг 3 из 6</span>
          <span>Придумай пароль</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '50%' }}></div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">
          Защити свой прогресс 🔒
        </h2>
        <p className="text-[#5A5F5A] text-center mb-8">
          Твои слова и книги будут сохранены в аккаунте
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="Пароль (минимум 6 символов)"
          className="input text-center text-lg py-4 mb-4"
        />

        <input
          type="password"
          value={confirm}
          onChange={(e) => { setConfirm(e.target.value); setError(''); }}
          placeholder="Повтори пароль"
          className="input text-center text-lg py-4 mb-4"
          onKeyPress={(e) => e.key === 'Enter' && handleNext()}
        />

        {error && (
          <p className="text-[#B85C5C] text-sm mb-4">{error}</p>
        )}

        <button
          onClick={handleNext}
          disabled={password.length < 6 || confirm.length < 6}
          className="btn-primary w-full py-4"
        >
          Продолжить
        </button>
      </div>

      <button onClick={onBack} className="text-[#5A5F5A] hover:text-[#20231F] mx-auto">
        ← Назад
      </button>
    </div>
  );
}