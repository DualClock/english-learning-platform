'use client';

import AlexAvatar from './AlexAvatar';
import Button from '@/components/ui/Button';
import { BulbIcon, SpeechIcon, TargetIcon } from '@/components/ui/icons';

const features = [
  {
    Icon: SpeechIcon,
    title: 'Свободная беседа',
    text: 'Болтаем как с другом — о чём угодно, в удобном темпе.',
  },
  {
    Icon: BulbIcon,
    title: 'Разбор каждого сообщения',
    text: 'Мягкие исправления и похвала после каждой твоей реплики.',
  },
  {
    Icon: TargetIcon,
    title: 'Уровень учитывается',
    text: 'Alex подстраивается под твой уровень английского.',
  },
];

export default function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="stagger mx-auto max-w-2xl pb-16 pt-8 text-center">
      <div className="mb-6 flex justify-center">
        <AlexAvatar size="xl" animated />
      </div>

      <h1 className="mb-3 text-h1 text-ink">Познакомьтесь: Alex</h1>
      <p className="mx-auto mb-10 max-w-measure text-body-lg text-slate">
        Твой AI-собеседник — носитель английского. Просто общайся, а Alex поможет
        говорить свободнее.
      </p>

      <div className="mb-10 grid gap-4 text-left sm:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.title} className="card p-5">
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
              <feature.Icon size={20} />
            </span>
            <h2 className="mb-1 text-h3 text-ink">{feature.title}</h2>
            <p className="text-body-sm text-slate">{feature.text}</p>
          </div>
        ))}
      </div>

      <Button onClick={onStart} className="px-10 text-body-lg">
        Начать разговор
      </Button>
    </div>
  );
}
