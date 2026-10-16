'use client';

interface StepProps {
  name: string;
  onComplete: () => void;
}

export default function StepFinal({ name, onComplete }: StepProps) {
  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col items-center justify-center p-6">
      {/* Праздничная иллюстрация */}
      <div className="relative mb-8">
        <div className="w-40 h-40 bg-[#E7ECE4] rounded-full flex items-center justify-center">
          <span className="text-6xl">🎉</span>
        </div>
        <div className="absolute -top-4 -right-4 text-4xl animate-bounce">✨</div>
        <div className="absolute -bottom-2 -left-4 text-3xl animate-bounce delay-100">📖</div>
      </div>

      {/* Поздравление */}
      <h2 className="text-3xl font-bold text-[#20231F] text-center mb-4">
        Привет, {name}!
      </h2>
      
      <div className="max-w-sm text-center mb-8">
        <p className="text-[#5A5F5A] mb-4">
          Твой персональный план готов. Мы подобрали книги под твой уровень и настроили умные повторения.
        </p>
        
        <div className="bg-[#E7ECE4] rounded-xl p-4 mb-4">
          <h3 className="font-semibold text-[#356B52] mb-2">Твой план на сегодня:</h3>
          <ul className="text-sm text-[#5A5F5A] space-y-1">
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

      <p className="text-sm text-[#5A5F5A] mt-6">
        Первые 7 дней бесплатно • Без карты
      </p>
    </div>
  );
}