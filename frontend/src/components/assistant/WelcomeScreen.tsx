'use client';

import AlexAvatar from './AlexAvatar';

const features = [
  {
    emoji: '💬',
    title: 'Свободная беседа',
    text: 'Болтаем как с другом — о чём угодно, в удобном темпе.',
  },
  {
    emoji: '💡',
    title: 'Разбор каждого сообщения',
    text: 'Мягкие исправления и похвала после каждой твоей реплики.',
  },
  {
    emoji: '🎯',
    title: 'Уровень учитывается',
    text: 'Alex подстраивается под твой уровень английского.',
  },
];

export default function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="max-w-2xl mx-auto text-center pt-8 pb-16">
      <div className="flex justify-center mb-6 assistant-fade-up">
        <AlexAvatar size="xl" animated />
      </div>

      <h1
        className="text-3xl font-bold text-[var(--color-ink)] mb-3 assistant-fade-up"
        style={{ animationDelay: '0.15s' }}
      >
        Познакомьтесь: Alex
      </h1>
      <p
        className="text-[var(--color-slate)] text-lg mb-10 assistant-fade-up"
        style={{ animationDelay: '0.3s' }}
      >
        Твой AI-собеседник — носитель английского. Просто общайся, а Alex поможет
        говорить свободнее.
      </p>

      <div className="grid gap-4 sm:grid-cols-3 mb-10 text-left">
        {features.map((feature, idx) => (
          <div
            key={feature.title}
            className="card p-5 assistant-fade-up"
            style={{ animationDelay: `${0.45 + idx * 0.2}s` }}
          >
            <div className="text-2xl mb-2">{feature.emoji}</div>
            <h3 className="font-semibold text-[var(--color-ink)] mb-1">{feature.title}</h3>
            <p className="text-sm text-[var(--color-slate)]">{feature.text}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        className="btn-primary text-lg px-10 assistant-fade-up"
        style={{ animationDelay: '1.1s' }}
      >
        Начать разговор
      </button>
    </div>
  );
}
