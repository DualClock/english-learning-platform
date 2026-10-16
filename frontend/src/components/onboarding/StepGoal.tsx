'use client';

import { useState } from 'react';

interface StepProps {
  onNext: (data: { goal: string }) => void;
  onBack: () => void;
}

const goals = [
  { id: 'travel', icon: '✈️', title: 'Путешествия', desc: 'Свободно общаться за границей' },
  { id: 'work', icon: '💼', title: 'Работа', desc: 'Карьера в международной компании' },
  { id: 'movies', icon: '🎬', title: 'Фильмы и сериалы', desc: 'Смотреть без перевода и субтитров' },
  { id: 'books', icon: '📚', title: 'Книги', desc: 'Читать классику в оригинале' },
  { id: 'talk', icon: '💬', title: 'Общение', desc: 'Разговаривать с носителями' },
  { id: 'exam', icon: '📝', title: 'Экзамен', desc: 'IELTS, TOEFL или другой' },
];

export default function StepGoal({ onNext, onBack }: StepProps) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
      <div className="w-full max-w-md mx-auto mb-8">
        <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
          <span>Шаг 4 из 6</span>
          <span>Твоя цель</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: '66%' }}></div>
        </div>
      </div>

      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">
          Зачем тебе английский? 🎯
        </h2>
        <p className="text-[#5A5F5A] text-center mb-8">
          Подберём книги и слова под твою цель
        </p>

        <div className="space-y-3 mb-8">
          {goals.map((goal) => (
            <button
              key={goal.id}
              onClick={() => setSelected(goal.id)}
              className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                selected === goal.id
                  ? 'border-[#356B52] bg-[#E7ECE4]'
                  : 'border-[#D6D3CC] bg-white hover:border-[#C4A77D]'
              }`}
            >
              <div className="flex items-center gap-4">
                <span className="text-3xl">{goal.icon}</span>
                <div>
                  <h3 className="font-semibold text-[#20231F]">{goal.title}</h3>
                  <p className="text-sm text-[#5A5F5A]">{goal.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => selected && onNext({ goal: selected })}
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