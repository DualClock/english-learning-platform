'use client';

import { motion, useInView, usePageInView, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ease } from '@/lib/motion';

export type LexiPose = 'stand' | 'wave' | 'read' | 'sleep' | 'celebrate';

interface LexiMascotProps {
  pose?: LexiPose;
  className?: string;
}

const bodyPath =
  'M52 82 C58 58 84 42 116 38 C132 36 146 38 158 42 C176 62 199 92 220 120 C221 124 221 128 220 132 C218 153 210 169 196 181 C182 193 165 198 149 199 C128 202 101 200 82 193 C62 186 47 169 42 149 C36 131 39 105 52 82Z';
const foldPath =
  'M158 42 C168 28 184 24 196 30 C205 35 211 49 215 68 C218 87 220 104 220 120 C198 96 176 68 158 42Z';

const legs = (
  <>
    <path d="M108 196 C102 210 100 224 100 234" />
    <path d="M142 196 C148 210 150 222 152 232" />
    <ellipse cx="97" cy="241" rx="13" ry="6" transform="rotate(-6 97 241)" className="fill-lexi-paper" />
    <ellipse cx="155" cy="239" rx="13" ry="6" transform="rotate(6 155 239)" className="fill-lexi-paper" />
  </>
);

const idleLegs = (
  <>
    <path d="M102 196 C96 210 94 220 94 228" />
    <path d="M148 196 C154 208 156 216 158 224" />
    <ellipse cx="91" cy="234" rx="12" ry="5.5" transform="rotate(-6 91 234)" className="fill-lexi-paper" />
    <ellipse cx="161" cy="230" rx="12" ry="5.5" transform="rotate(6 161 230)" className="fill-lexi-paper" />
  </>
);

const armsDown = (
  <>
    <path d="M56 140 C48 150 45 162 46 172" />
    <circle cx="46" cy="176" r="7.5" className="fill-lexi-paper" />
    <path d="M204 140 C212 150 215 162 214 172" />
    <circle cx="214" cy="176" r="7.5" className="fill-lexi-paper" />
  </>
);

interface FaceProps {
  eyes: 'open' | 'sleepy' | 'closed';
  brows: 'neutral' | 'raised' | 'oneUp' | 'low';
  mouth: 'smile' | 'big' | 'sleep';
  blinking?: boolean;
}

function Face({ eyes, brows, mouth, blinking = false }: FaceProps) {
  return (
    <>
      <g stroke="none">
        <ellipse cx="70" cy="144" rx="15.5" ry="9.5" className="fill-lexi-blush" />
        <ellipse cx="170" cy="144" rx="15.5" ry="9.5" className="fill-lexi-blush" />
      </g>

      {eyes === 'open' && (
        <motion.g
          initial={false}
          animate={{ scaleY: blinking ? 0.08 : 1 }}
          transition={{ duration: 0.1, ease: 'easeOut' }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <ellipse cx="100" cy="117" rx="7.4" ry="11.2" className="fill-lexi-line" stroke="none" />
          <circle cx="97.4" cy="113" r="2" className="fill-lexi-paper" stroke="none" />
          <ellipse cx="144" cy="117" rx="7.4" ry="11.2" className="fill-lexi-line" stroke="none" />
          <circle cx="141.4" cy="113" r="2" className="fill-lexi-paper" stroke="none" />
        </motion.g>
      )}
      {eyes === 'sleepy' && (
        <>
          <path d="M92 114 C96 121 105 121 109 114" strokeWidth="3.1" />
          <path d="M137 114 C141 121 149 121 153 114" strokeWidth="3.1" />
        </>
      )}
      {eyes === 'closed' && (
        <>
          <path d="M92 117 C96 108 104 108 108 117" strokeWidth="3.1" />
          <path d="M137 117 C141 108 148 108 152 117" strokeWidth="3.1" />
        </>
      )}

      {brows === 'neutral' && (
        <>
          <path d="M90 92 C96 87 104 87 110 90" strokeWidth="3.1" />
          <path d="M136 89 C142 86 150 87 155 92" strokeWidth="3.1" />
        </>
      )}
      {brows === 'raised' && (
        <>
          <path d="M89 88 C95 82 104 82 111 86" strokeWidth="3.1" />
          <path d="M135 84 C142 81 150 82 156 88" strokeWidth="3.1" />
        </>
      )}
      {brows === 'oneUp' && (
        <>
          <path d="M89 87 C95 81 104 82 111 86" strokeWidth="3.1" />
          <path d="M137 91 C143 88 150 89 155 94" strokeWidth="3.1" />
        </>
      )}
      {brows === 'low' && (
        <>
          <path d="M91 94 C97 91 104 91 109 93" strokeWidth="3.1" />
          <path d="M137 93 C143 91 150 92 155 96" strokeWidth="3.1" />
        </>
      )}

      {mouth === 'smile' && <path d="M114 140 C118 146 125 146 130 140" strokeWidth="3.1" />}
      {mouth === 'big' && <path d="M110 137 C116 149 129 149 135 137" strokeWidth="3.1" />}
      {mouth === 'sleep' && <path d="M117 142 C121 144 126 144 129 142" strokeWidth="3.1" />}
    </>
  );
}

export default function LexiMascot({ pose = 'stand', className = '' }: LexiMascotProps) {
  const reducedMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inView = useInView(wrapRef);
  const pageInView = usePageInView();
  const active = inView && pageInView && !reducedMotion;

  const [blinking, setBlinking] = useState(false);
  const hasOpenEyes = pose === 'stand' || pose === 'wave' || pose === 'read';

  useEffect(() => {
    if (!active || !hasOpenEyes) {
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
        4200 + Math.random() * 3200,
      );
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(nextTimer);
      window.clearTimeout(closeTimer);
    };
  }, [active, hasOpenEyes]);

  const tilt = pose === 'sleep' ? -7 : 0;
  const breathing =
    pose === 'sleep'
      ? { scaleY: [1, 1.025, 1], y: [0, 2, 0], rotate: tilt }
      : pose === 'celebrate'
        ? { scaleY: [1, 1.02, 1], y: 0, rotate: 0 }
        : { scaleY: [1, 1.012, 1], y: 0, rotate: 0 };
  const breatheDuration = pose === 'sleep' ? 5.2 : 4;

  const face: FaceProps =
    pose === 'sleep'
      ? { eyes: 'sleepy', brows: 'low', mouth: 'sleep' }
      : pose === 'celebrate'
        ? { eyes: 'closed', brows: 'raised', mouth: 'big' }
        : pose === 'wave'
          ? { eyes: 'open', brows: 'raised', mouth: 'big', blinking }
          : pose === 'read'
            ? { eyes: 'open', brows: 'oneUp', mouth: 'smile', blinking }
            : { eyes: 'open', brows: 'neutral', mouth: 'smile', blinking };

  return (
    <div ref={wrapRef} className={`pointer-events-none select-none ${className}`} aria-hidden="true">
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.12, ease: ease.soft }}
      >
        <motion.div
          animate={
            active && pose === 'celebrate'
              ? { y: [0, -9, 0], rotate: [0, -1.5, 0] }
              : { y: 0, rotate: 0 }
          }
          transition={
            active && pose === 'celebrate'
              ? { duration: 1.6, repeat: Infinity, repeatDelay: 1.1, ease: 'easeInOut' }
              : { duration: 0.2 }
          }
        >
          <svg viewBox="0 0 260 280" className="block h-auto w-full overflow-visible" fill="none" focusable="false">
            <g transform="translate(10 0)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
              <motion.g
                className="stroke-lexi-line"
                animate={active ? breathing : { scaleY: 1, y: 0, rotate: tilt }}
                transition={active ? { duration: breatheDuration, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2, ease: ease.soft }}
                style={{ transformBox: 'fill-box', transformOrigin: '50% 92%' }}
              >
                {pose === 'sleep' && idleLegs}
                {pose === 'celebrate' ? (
                  <>
                    <path d="M108 196 C104 212 104 226 106 236" />
                    <path d="M142 196 C146 210 148 222 150 232" />
                    <ellipse cx="102" cy="243" rx="13" ry="6" transform="rotate(-8 102 243)" className="fill-lexi-paper" />
                    <ellipse cx="154" cy="239" rx="13" ry="6" transform="rotate(8 154 239)" className="fill-lexi-paper" />
                    <path d="M58 130 C48 116 42 100 38 82" />
                    <circle cx="36" cy="76" r="8" className="fill-lexi-paper" />
                    <path d="M202 130 C212 116 222 100 228 82" />
                    <circle cx="230" cy="76" r="8" className="fill-lexi-paper" />
                  </>
                ) : pose === 'wave' ? (
                  <>
                    {legs}
                    <path d="M204 140 C212 150 215 162 214 172" />
                    <circle cx="214" cy="176" r="7.5" className="fill-lexi-paper" />
                    <motion.g
                      animate={active ? { rotate: [0, -14, 6, -14, 0] } : { rotate: 0 }}
                      transition={
                        active
                          ? { duration: 1.8, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }
                          : { duration: 0.2 }
                      }
                      style={{ transformBox: 'fill-box', transformOrigin: '100% 100%' }}
                    >
                      <path d="M57 132 C44 124 34 112 29 100" />
                      <circle cx="26" cy="94" r="8.5" className="fill-lexi-paper" />
                      <g strokeWidth="3">
                        <path d="M22 82 C24 77 26 73 29 69" />
                        <path d="M32 74 C34 70 37 67 40 64" />
                      </g>
                    </motion.g>
                  </>
                ) : (
                  <>
                    {legs}
                    {pose === 'stand' && armsDown}
                    {pose === 'read' && (
                      <>
                        <path d="M58 150 C66 158 72 168 78 178" />
                        <path d="M202 150 C194 158 188 168 182 178" />
                      </>
                    )}
                  </>
                )}

                <path className="fill-lexi-paper" d={bodyPath} />
                <path className="fill-lexi-fold" strokeWidth="3.6" d={foldPath} />
                <Face {...face} />

                {pose === 'sleep' && (
                  <>
                    <circle cx="49" cy="173" r="7" className="fill-lexi-paper" />
                    <circle cx="211" cy="173" r="7" className="fill-lexi-paper" />
                  </>
                )}

                {pose === 'read' && (
                  <>
                    <ellipse cx="92" cy="230" rx="13" ry="6" transform="rotate(-6 92 230)" className="fill-lexi-paper" />
                    <ellipse cx="150" cy="230" rx="13" ry="6" transform="rotate(6 150 230)" className="fill-lexi-paper" />
                    <path d="M82 164 L120 158 L120 212 L82 218 Z" className="fill-lexi-accent" />
                    <path d="M120 158 L158 164 L158 218 L120 212 Z" className="fill-lexi-accent" />
                    <path d="M87 170 L116 165 L116 207 L87 212 Z" className="fill-lexi-paper" />
                    <path d="M124 165 L153 170 L153 212 L124 207 Z" className="fill-lexi-paper" />
                    <path d="M120 158 L120 212" />
                    <g strokeWidth="2.4">
                      <path d="M93 180 L110 177 M93 191 L110 188 M130 177 L147 180 M130 188 L147 191" />
                    </g>
                    <circle cx="78" cy="180" r="7.5" className="fill-lexi-paper" />
                    <circle cx="162" cy="180" r="7.5" className="fill-lexi-paper" />
                  </>
                )}
              </motion.g>
            </g>

            {pose === 'celebrate' && (
              <g className="fill-lexi-accent" stroke="none">
                <motion.path
                  animate={active ? { opacity: [0.4, 1, 0.4], scale: [0.85, 1, 0.85] } : { opacity: 1, scale: 1 }}
                  transition={active ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  d="M242 42 C243.5 50 246 52.5 254 54 C246 55.5 243.5 58 242 66 C240.5 58 238 55.5 230 54 C238 52.5 240.5 50 242 42Z"
                />
                <motion.circle
                  cx="255"
                  cy="74"
                  r="3"
                  animate={active ? { opacity: [0.5, 1, 0.5] } : { opacity: 1 }}
                  transition={active ? { duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.4 } : { duration: 0.2 }}
                />
                <motion.path
                  animate={active ? { opacity: [0.35, 0.9, 0.35], scale: [0.9, 1, 0.9] } : { opacity: 0.8, scale: 1 }}
                  transition={active ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 0.7 } : { duration: 0.2 }}
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                  d="M22 44 C23 49 24.5 50.5 29.5 51.5 C24.5 52.5 23 54 22 59 C21 54 19.5 52.5 14.5 51.5 C19.5 50.5 21 49 22 44Z"
                />
              </g>
            )}

            {pose === 'sleep' && (
              <g className="fill-lexi-accent" stroke="none">
                {[
                  { d: 'M227 96 L245 96 L227 114 L245 114', delay: 0 },
                  { d: 'M236 64 L250 64 L236 78 L250 78', delay: 0.5 },
                  { d: 'M248 40 L257 40 L248 49 L257 49', delay: 1 },
                ].map((z) => (
                  <motion.path
                    key={z.d}
                    d={z.d}
                    animate={active ? { opacity: [0, 1, 0], y: [4, -6, -14] } : { opacity: 0.9, y: 0 }}
                    transition={active ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: z.delay } : { duration: 0.2 }}
                  />
                ))}
              </g>
            )}
          </svg>
        </motion.div>
      </motion.div>
    </div>
  );
}
