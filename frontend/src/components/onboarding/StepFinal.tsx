'use client';

interface StepProps {
  name: string;
  onComplete: () => void;
}

export default function StepFinal({ name, onComplete }: StepProps) {
  return (
    <div className="min-h-screen bg-[var(--color-surface)] flex flex-col items-center justify-center p-6">
      {/* Праздничная иллюстрация */}
      <div className="relative mb-8">
        <div className="w-40 h-40 bg-[var(--color-tint-mint)] rounded-full flex items-center justify-center">
          <span className="text-6xl">🎉</span>
        </div>
        <div className="absolute -top-4 -right-4 text-4xl animate-bounce">✨</div>
        <div className="absolute -bottom-2 -left-4 text-3xl animate-bounce delay-100">📖</div>
      </div>

      {/* Поздравление */}
      <h2 className="text-3xl font-bold text-[var(--color-ink)] text-center mb-4">
        Привет, {name}!
      </h2>
      
      <div className="max-w-sm text-center mb-8">
        <p className="text-[var(--color-slate)] mb-4">
          Твой персональный план готов. Мы подобрали книги под твой уровень и настроили умные повторения.
        </p>
        
        <div className="bg-[var(--color-tint-mint)] rounded-xl p-4 mb-4">
          <h3 className="font-semibold text-[var(--color-primary)] mb-2">Твой план на сегодня:</h3>
          <ul className="text-sm text-[var(--color-slate)] space-y-1">
            <li>📖 Прочитать 10 страниц</li>
            <li>🔄 Повторить 5 слов</li>
            <li>✓ Пройти мини-тест</li>
          </ul>
        </div>
      </div>

      {/* Кнопка */}
      <button
        onClick={onComplete}
        className="btn-primary w-full max-w-xs py-4 text-lg"
      >
        Начать учиться →
      </button>

      <p className="text-sm text-[var(--color-slate)] mt-6">
        Первые 7 дней бесплатно • Без карты
      </p>
    </div>
  );
}