'use client';

import { AnimatePresence, motion, useAnimate, useInView, usePageInView, useReducedMotion, useSpring } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { ease, transition } from '@/lib/motion';

export type LexiMood = 'neutral' | 'curious' | 'happy' | 'proud' | 'sleepy' | 'thinking';

interface LexiPeekProps {
  mood?: LexiMood;
  /** Куда смотрит Лекси, когда курсор не ведёт её: -1…1 по осям. */
  focus?: { x: number; y: number };
  /** Новый номер реакции запускает мягкий подскок. */
  reaction?: number;
  /** Замирает полностью: ни дыхания, ни моргания (идёт запись — микрофон активен). */
  paused?: boolean;
  className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function LexiPeek({
  mood = 'neutral',
  focus = { x: 0.5, y: 0.8 },
  reaction = 0,
  paused = false,
  className = '',
}: LexiPeekProps) {
  const reducedMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scope, animate] = useAnimate();
  const inView = useInView(wrapRef);
  const pageInView = usePageInView();
  const active = inView && pageInView && !reducedMotion && !paused;

  const [blinking, setBlinking] = useState(false);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clipId = `lexi-bust-${uid}`;

  const gazeX = useSpring(0, { stiffness: 140, damping: 22, mass: 0.4 });
  const gazeY = useSpring(0, { stiffness: 140, damping: 22, mass: 0.4 });

  const eyesOpen = mood !== 'proud' && mood !== 'sleepy';
  const brows =
    mood === 'sleepy'
      ? 'low'
      : mood === 'proud' || mood === 'happy'
        ? 'raised'
        : mood === 'curious' || mood === 'thinking'
          ? 'oneUp'
          : 'neutral';
  const mouth = mood === 'sleepy' ? 'sleep' : mood === 'proud' || mood === 'happy' ? 'big' : mood === 'thinking' ? 'think' : 'smile';

  useEffect(() => {
    if (reducedMotion) return;
    gazeX.set(focus.x * 1.6);
    gazeY.set(focus.y * 1.6);
  }, [focus.x, focus.y, gazeX, gazeY, reducedMotion]);

  useEffect(() => {
    if (!active || !window.matchMedia('(pointer: fine)').matches) return;
    const node = wrapRef.current;
    if (!node) return;

    let frame = 0;
    let last: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      if (!last) return;
      const rect = node.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height * 0.42;
      const x = clamp((last.clientX - centerX) / (rect.width * 1.6), -1, 1);
      const y = clamp((last.clientY - centerY) / (rect.height * 2.2), -1, 1);
      gazeX.set(focus.x * 1.2 + x * 2.2);
      gazeY.set(focus.y * 1.2 + y * 1.8);
    };

    const onPointerMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active, focus.x, focus.y, gazeX, gazeY]);

  useEffect(() => {
    if (!active) {
      setBlinking(false);
      return;
    }

    let cancelled = false;
    let nextTimer = 0;
    let closeTimer = 0;

    const schedule = () => {
      nextTimer = window.setTimeout(
        () => {
          if (cancelled) return;
          setBlinking(true);
          closeTimer = window.setTimeout(() => {
            setBlinking(false);
            schedule();
          }, 120);
        },
        4200 + Math.random() * 3000,
      );
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(nextTimer);
      window.clearTimeout(closeTimer);
    };
  }, [active]);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reducedMotion || !scope.current) return;
    animate(scope.current, { y: [0, -4, 0], scale: [1, 1.015, 1] }, { duration: 0.42, ease: ease.soft });
  }, [reaction, animate, reducedMotion, scope]);

  const eyeStyle = reducedMotion
    ? { x: focus.x * 1.6, y: focus.y * 1.6 }
    : { x: gazeX, y: gazeY };

  return (
    <div ref={wrapRef} className={`pointer-events-none select-none ${className}`} aria-hidden="true">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18, ease: ease.soft }}
      >
        <div ref={scope}>
          <svg
            viewBox="0 20 240 152"
            className="block h-auto w-full overflow-visible"
            fill="none"
            focusable="false"
          >
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width="240" height="172" />
              </clipPath>
            </defs>

            <g clipPath={`url(#${clipId})`}>
              <motion.g
                animate={active ? { scaleY: [1, 1.012, 1] } : { scaleY: 1 }}
                transition={
                  active
                    ? { duration: 4, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.2, ease: ease.soft }
                }
                style={{ transformBox: 'fill-box', transformOrigin: '50% 92%' }}
                className="stroke-lexi-line"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path
                  className="fill-lexi-paper"
                  d="M52 82
                    C58 58 84 42 116 38
                    C132 36 146 38 158 42
                    C176 62 199 92 220 120
                    C221 124 221 128 220 132
                    C218 153 210 169 196 181
                    C182 193 165 198 149 199
                    C128 202 101 200 82 193
                    C62 186 47 169 42 149
                    C36 131 39 105 52 82Z"
                />
                <path
                  className="fill-lexi-fold"
                  strokeWidth="3.6"
                  d="M158 42
                    C168 28 184 24 196 30
                    C205 35 211 49 215 68
                    C218 87 220 104 220 120
                    C198 96 176 68 158 42Z"
                />

                <g stroke="none">
                  <ellipse cx="70" cy="144" rx="15.5" ry="9.5" className="fill-lexi-blush" />
                  <ellipse cx="170" cy="144" rx="15.5" ry="9.5" className="fill-lexi-blush" />
                </g>

                <motion.g
                  initial={false}
                  animate={{ opacity: eyesOpen ? 1 : 0 }}
                  transition={transition.fast}
                >
                  <motion.g style={eyeStyle}>
                    <motion.g
                      initial={false}
                      animate={{ scaleY: blinking ? 0.08 : 1 }}
                      transition={{ duration: 0.1, ease: 'easeOut' }}
                      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    >
                      <ellipse cx="100" cy="117" rx="7.4" ry="11.2" className="fill-lexi-line" stroke="none" />
                      <circle cx="97.4" cy="113" r="2" className="fill-lexi-paper" stroke="none" />
                    </motion.g>
                    <motion.g
                      initial={false}
                      animate={{ scaleY: blinking ? 0.08 : 1 }}
                      transition={{ duration: 0.1, ease: 'easeOut' }}
                      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                    >
                      <ellipse cx="144" cy="117" rx="7.4" ry="11.2" className="fill-lexi-line" stroke="none" />
                      <circle cx="141.4" cy="113" r="2" className="fill-lexi-paper" stroke="none" />
                    </motion.g>
                  </motion.g>
                </motion.g>

                <motion.g
                  initial={false}
                  animate={{ opacity: eyesOpen ? 0 : 1 }}
                  transition={transition.fast}
                >
                  {mood === 'sleepy' ? (
                    <>
                      <path d="M92 114 C96 121 105 121 109 114" strokeWidth="3.1" />
                      <path d="M137 114 C141 121 149 121 153 114" strokeWidth="3.1" />
                    </>
                  ) : (
                    <>
                      <path d="M92 117 C96 108 104 108 108 117" strokeWidth="3.1" />
                      <path d="M137 117 C141 108 148 108 152 117" strokeWidth="3.1" />
                    </>
                  )}
                </motion.g>

                <motion.g initial={false} animate={{ opacity: brows === 'neutral' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M90 92 C96 87 104 87 110 90" strokeWidth="3.1" />
                  <path d="M136 89 C142 86 150 87 155 92" strokeWidth="3.1" />
                </motion.g>
                <motion.g initial={false} animate={{ opacity: brows === 'raised' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M89 88 C95 82 104 82 111 86" strokeWidth="3.1" />
                  <path d="M135 84 C142 81 150 82 156 88" strokeWidth="3.1" />
                </motion.g>
                <motion.g initial={false} animate={{ opacity: brows === 'oneUp' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M89 87 C95 81 104 82 111 86" strokeWidth="3.1" />
                  <path d="M137 91 C143 88 150 89 155 94" strokeWidth="3.1" />
                </motion.g>
                <motion.g initial={false} animate={{ opacity: brows === 'low' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M91 94 C97 91 104 91 109 93" strokeWidth="3.1" />
                  <path d="M137 93 C143 91 150 92 155 96" strokeWidth="3.1" />
                </motion.g>

                <motion.g initial={false} animate={{ opacity: mouth === 'smile' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M114 140 C118 146 125 146 130 140" strokeWidth="3.1" />
                </motion.g>
                <motion.g initial={false} animate={{ opacity: mouth === 'big' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M110 137 C116 149 129 149 135 137" strokeWidth="3.1" />
                </motion.g>
                <motion.g initial={false} animate={{ opacity: mouth === 'think' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M116 142 C120 140 125 140 129 142" strokeWidth="3.1" />
                </motion.g>
                <motion.g initial={false} animate={{ opacity: mouth === 'sleep' ? 1 : 0 }} transition={transition.fast}>
                  <path d="M117 142 C121 144 126 144 129 142" strokeWidth="3.1" />
                </motion.g>
              </motion.g>
            </g>

            <g className="stroke-lexi-line" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="55" cy="165" rx="11" ry="11" className="fill-lexi-paper" />
              <ellipse cx="205" cy="164" rx="11" ry="11" className="fill-lexi-paper" />
            </g>

            <AnimatePresence>
              {mood === 'proud' && (
                <motion.g
                  key="spark"
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: -14 }}
                  animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 8 }}
                  transition={transition.correct}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                >
                  <path
                    className="fill-lexi-accent"
                    d="M224 40
                      C225.5 48 228 50.5 236 52
                      C228 53.5 225.5 56 224 64
                      C222.5 56 220 53.5 212 52
                      C220 50.5 222.5 48 224 40Z"
                  />
                  <circle cx="237" cy="72" r="3" className="fill-lexi-accent" />
                </motion.g>
              )}
            </AnimatePresence>
          </svg>
        </div>
      </motion.div>
    </div>
  );
}
