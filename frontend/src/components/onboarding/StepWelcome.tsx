'use client';

interface StepProps {
  onNext: () => void;
}

export default function StepWelcome({ onNext }: StepProps) {
  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex flex-col items-center justify-center p-6">
      {/* Лого */}
      <div className="mb-12">
        <h1 className="text-3xl font-bold text-[var(--color-ink)]">Lexicon</h1>
      </div>

      {/* Иллюстрация — книга в руках */}
      <div className="relative mb-12">
        <div className="w-48 h-48 bg-[var(--color-tint-mint)] rounded-full flex items-center justify-center">
          <span className="text-7xl">📚</span>
        </div>
        <div className="absolute -bottom-2 -right-2 w-16 h-16 bg-[var(--color-tint-yellow-bold)] rounded-full flex items-center justify-center text-2xl">
          ✨
        </div>
      </div>

      {/* Текст */}
      <h2 className="text-2xl font-bold text-[var(--color-ink)] text-center mb-4">
        Добро пожаловать!
      </h2>
      <p className="text-[var(--color-slate)] text-center max-w-sm mb-12">
        Учи английский через настоящие книги, а не скучные учебники
      </p>

      {/* Кнопка */}
      <button
        onClick={onNext}
        className="btn-primary w-full max-w-xs py-4 text-lg"
      >
        Начать →
      </button>

      {/* Уже есть аккаунт */}
      <a href="/login" className="mt-6 text-[var(--color-slate)] hover:text-[var(--color-ink)]">
        У меня уже есть аккаунт
      </a>
    </div>
  );
}