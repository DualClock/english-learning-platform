'use client';

import { motion, useAnimate, usePageInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ease } from '@/lib/motion';

interface LexiSignProps {
  /** Ключ маршрута: при его смене знак кивает. */
  pageKey?: string;
  className?: string;
}

const bodyPath =
  'M52 82 C58 58 84 42 116 38 C132 36 146 38 158 42 C176 62 199 92 220 120 C221 124 221 128 220 132 C218 153 210 169 196 181 C182 193 165 198 149 199 C128 202 101 200 82 193 C62 186 47 169 42 149 C36 131 39 105 52 82Z';
const foldPath =
  'M158 42 C168 28 184 24 196 30 C205 35 211 49 215 68 C218 87 220 104 220 120 C198 96 176 68 158 42Z';

export default function LexiSign({ pageKey = '', className = '' }: LexiSignProps) {
  const reducedMotion = useReducedMotion();
  const pageInView = usePageInView();
  const [scope, animate] = useAnimate();
  const active = pageInView && !reducedMotion;

  const [blinking, setBlinking] = useState(false);

  // Одно моргание после появления — тихая марка, а не бесконечный цикл.
  useEffect(() => {
    if (!active) {
      setBlinking(false);
      return;
    }
    let cancelled = false;
    let openTimer = 0;
    let closeTimer = 0;
    openTimer = window.setTimeout(() => {
      if (cancelled) return;
      setBlinking(true);
      closeTimer = window.setTimeout(() => {
        if (!cancelled) setBlinking(false);
      }, 130);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(openTimer);
      window.clearTimeout(closeTimer);
    };
  }, [active]);

  // Реакция на переход между страницами: короткий кивок.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    if (reducedMotion || !scope.current) return;
    animate(scope.current, { rotate: [0, -10, 6, 0], y: [0, 1.5, 0] }, { duration: 0.55, ease: ease.soft });
  }, [pageKey, animate, reducedMotion, scope]);

  return (
    <div className={`pointer-events-none select-none ${className}`} aria-hidden="true">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: ease.soft }}
        className="h-full w-full"
      >
        <div ref={scope} className="h-full w-full" style={{ transformOrigin: '50% 90%' }}>
          <svg viewBox="36 30 188 112" className="block h-full w-full overflow-visible" fill="none" focusable="false">
            <g strokeLinecap="round" strokeLinejoin="round" className="stroke-lexi-line">
              <path className="fill-lexi-paper" strokeWidth="10" d={bodyPath} />
              <path className="fill-lexi-fold" strokeWidth="7" d={foldPath} />
              <g stroke="none">
                <ellipse cx="70" cy="144" rx="15.5" ry="9.5" className="fill-lexi-blush" />
                <ellipse cx="170" cy="144" rx="15.5" ry="9.5" className="fill-lexi-blush" />
              </g>
              <motion.g
                initial={false}
                animate={{ scaleY: blinking ? 0.1 : 1 }}
                transition={{ duration: 0.1, ease: 'easeOut' }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                <ellipse cx="100" cy="117" rx="7.4" ry="11.2" className="fill-lexi-line" stroke="none" />
                <ellipse cx="144" cy="117" rx="7.4" ry="11.2" className="fill-lexi-line" stroke="none" />
              </motion.g>
              <g strokeWidth="6">
                <path d="M90 92 C96 87 104 87 110 90" />
                <path d="M136 89 C142 86 150 87 155 92" />
              </g>
              <path d="M114 140 C118 146 125 146 130 140" strokeWidth="6" />
            </g>
          </svg>
        </div>
      </motion.div>
    </div>
  );
}
