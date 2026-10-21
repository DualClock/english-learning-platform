'use client';

import { TUTORIAL_STEPS } from './types';

interface Props {
  step: number;
  visible: boolean;
  onAdvance: () => void;
  onSkip: () => void;
}

const LAST_STEP = TUTORIAL_STEPS.length - 1;

/** «Прожектор» над элементом интерфейса и карточка с подсказкой шага. */
export default function ReaderTutorial({ step, visible, onAdvance, onSkip }: Props) {
  const current = TUTORIAL_STEPS[step];
  if (!current) return null;
  const isLast = step === LAST_STEP;

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute rounded-full transition-opacity duration-300"
        style={{
          top: current.circle.top,
          left: current.circle.left,
          width: current.circle.size,
          height: current.circle.size,
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)',
          opacity: visible ? 1 : 0,
        }}
      />
      <div
        className="absolute w-80 max-w-[90vw] bg-white rounded-xl border border-[var(--color-hairline-strong)] p-5 shadow-2xl transition-all duration-200"
        style={{
          top: current.card.top,
          left: current.card.left,
          transform: `translateX(-50%) scale(${visible ? 1 : 0.95})`,
          opacity: visible ? 1 : 0,
        }}
      >
        <p className="text-xs font-semibold text-[var(--color-primary)] mb-2">
          Шаг {step + 1} из {TUTORIAL_STEPS.length}
        </p>
        <p className="text-sm text-[var(--color-ink)] leading-relaxed mb-4">{current.text}</p>
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onSkip}
            className="text-xs text-[var(--color-slate)] hover:text-[var(--color-ink)] transition-colors"
          >
            Пропустить
          </button>
          <button onClick={onAdvance} className="btn-primary text-sm py-2 px-5">
            {isLast ? 'Начать читать' : 'Далее'}
          </button>
        </div>
      </div>
    </div>
  );
}
