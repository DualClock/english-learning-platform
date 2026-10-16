'use client';

import { useState } from 'react';

interface StepProps {
  onNext: (data: { time: string }) => void;
  onBack: () => void;
}

const timeOptions = [
  { id: '5', label: '5 минут', desc: 'В метро или на перерыве' },
  { id: '15', label: '15 минут', desc: 'Утром с кофе' },
  { id: '30', label: '30 минут', desc: 'Вечером перед сном' },
  { id: '60', label: 'Час и больше', desc: 'Серьёзная практика' },
];

export default function StepTime({ onNext, onBack }: StepProps) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
      <div className="w-full max-w-md mx-auto mb-8">
        <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
          <span>Шаг 5 из 6</span>
          <span>Сколько времени?</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '83%' }}></div>
        </div>
      </div>

      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">
          Сколько времени готов уделять? ⏰
        </h2>
        <p className="text-[#5A5F5A] text-center mb-8">
          Честный ответ поможет составить реалистичный план
        </p>

        <div className="space-y-3 mb-8">
          {timeOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelected(option.id)}
              className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                selected === option.id
                  ? 'border-[#356B52] bg-[#E7ECE4]'
                  : 'border-[#D6D3CC] bg-white hover:border-[#C4A77D]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#20231F]">{option.label}</span>
                <span className="text-sm text-[#5A5F5A]">{option.desc}</span>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => selected && onNext({ time: selected })}
          disabled={!selected}
          className="btn-primary w-full py-4"
        >
          Продолжить
        </button>
      </div>

      <button onClick={onBack} className="text-[#5A5F5A] hover:text-[#20231F] mx-auto mt-4">
        ← Назад
      </button>
    </div>
  );
}