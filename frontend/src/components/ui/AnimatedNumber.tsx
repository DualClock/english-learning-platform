'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'motion/react';
import { formatNumber } from '@/lib/format';

interface Props {
  value: number;
  className?: string;
}

/**
 * Значение догоняет новое число. В HTML всегда лежит настоящий итог:
 * в фоновой вкладке, у краулеров и при prefers-reduced-motion анимации
 * нет, и цифра не должна залипать на нуле.
 */
export default function AnimatedNumber({ value, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || document.visibilityState !== 'visible') {
      node.textContent = formatNumber(value);
      from.current = value;
      return;
    }

    const controls = animate(from.current, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = formatNumber(latest);
      },
    });
    from.current = value;

    return () => controls.stop();
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {formatNumber(value)}
    </span>
  );
}
