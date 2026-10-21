'use client';

import { motion } from 'motion/react';
import { duration, ease } from '@/lib/motion';
import Button from '@/components/ui/Button';
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
        style={{ top: current.card.top, left: current.card.left }}
        initial={{ opacity: 0, scale: 0.95, x: '-50%' }}
        animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.95, x: '-50%' }}
        transition={{ duration: duration.fast, ease: ease.soft }}
      >
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
