'use client';

import { motion } from 'motion/react';
import { duration, ease } from '@/lib/motion';
import Button from '@/components/ui/Button';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
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
    <motion.div className="fixed inset-0 z-[60]" exit={{ opacity: 0 }}>
      <motion.div
        className="absolute rounded-full"
        style={{
          top: current.circle.top,
          left: current.circle.left,
          width: current.circle.size,
          height: current.circle.size,
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 9999px var(--color-scrim)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={{ duration: duration.base, ease: ease.soft }}
      />
      <motion.div
        className="card absolute w-80 max-w-[90vw] p-5 shadow-modal"
        style={{
          top: current.card.top,
          // На узких экранах карточка не должна вылезать за край: w-80 (320px)
          // с центровкой по left 40% на 390px даёт 4px отступа влево за экран.
          left: `clamp(176px, ${current.card.left}, calc(100vw - 176px))`,
        }}
        initial={{ opacity: 0, scale: 0.95, x: '-50%' }}
        animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.95, x: '-50%' }}
        transition={{ duration: duration.fast, ease: ease.soft }}
      >
        {/* Единственный экран, где Lexi объясняет жестом: указывает на подсвеченный элемент */}
        <LexiMascot pose="point" className="absolute -top-20 left-1/2 w-20 -translate-x-1/2" />
        <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-primary">
          Шаг {step + 1} из {TUTORIAL_STEPS.length}
        </p>
        <p className="mb-4 text-body-sm leading-relaxed text-ink">{current.text}</p>
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={onSkip} className="text-caption">
            Пропустить
          </Button>
          <Button onClick={onAdvance}>{isLast ? 'Начать читать' : 'Далее'}</Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
