'use client';

import { useState } from 'react';

interface StepProps {
  onNext: (data: { level: string }) => void;
  onBack: () => void;
}

const levels = [
  { id: 'beginner', emoji: '🐣', title: 'Абсолютный новичок', desc: 'Знаю несколько базовых слов' },
  { id: 'elementary', emoji: '🐥', title: 'Новичок с основами', desc: 'Могу говорить о простых вещах' },
  { id: 'intermediate', emoji: '🚶', title: 'Ниже среднего', desc: 'Веду простые разговоры, нужна практика' },
  { id: 'upper', emoji: '💬', title: 'Средний разговор', desc: 'Комфортно говорю, но делаю ошибки' },
  { id: 'advanced', emoji: '🧠', title: 'Продвинутый', desc: 'Говорю ясно, развиваю навыки' },
  { id: 'fluent', emoji: '🌍', title: 'Почти как носитель', desc: 'Свободно говорю, оттачиваю детали' },
];

export default function StepLevel({ onNext, onBack }: StepProps) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
      <div className="w-full max-w-md mx-auto mb-8">
        <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
          <span>Шаг 6 из 6</span>
          <span>Твой уровень</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '100%' }}></div>
        </div>
      </div>

      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">
          Какой у тебя уровень? 📊
        </h2>
        <p className="text-[#5A5F5A] text-center mb-8">
          Не уверен? Выбери примерное — потом пройдём тест
        </p>

        <div className="space-y-3 mb-8">
          {levels.map((level) => (
            <button
              key={level.id}
              onClick={() => setSelected(level.id)}
              className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                selected === level.id
                  ? 'border-[#356B52] bg-[#E7ECE4]'
                  : 'border-[#D6D3CC] bg-white hover:border-[#C4A77D]'
              }`}
            >
              <div className="flex items-center gap-4">
                <span className="text-2xl">{level.emoji}</span>
                <div>
                  <h3 className="font-semibold text-[#20231F]">{level.title}</h3>
                  <p className="text-sm text-[#5A5F5A]">{level.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => selected && onNext({ level: selected })}
          disabled={!selected}
          className="btn-primary w-full py-4"
        >
          Создать аккаунт
        </button>
      </div>

      <button onClick={onBack} className="text-[#5A5F5A] hover:text-[#20231F] mx-auto mt-4">
        ← Назад
      </button>
    </div>
  );
}