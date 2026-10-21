'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, PlusIcon } from './ui/icons';

type Phase =
  | 'idle'
  | 'approach'
  | 'click'
  | 'thinking'
  | 'typing'
  | 'save'
  | 'saved'
  | 'hold'
  | 'fade';

const TYPE_SPEED = 30;

const SEGMENTS = [
  { key: 'word', text: 'thirteen' },
  { key: 'transcription', text: '/θɜːˈtiːn/' },
  { key: 'translation', text: 'тринадцать' },
  {
    key: 'context',
    text: 'В контексте: часы пробили тринадцать — время, которого не бывает. Мир уже изменился.',
  },
];

const STARTS: number[] = [];
const TOTAL = SEGMENTS.reduce((acc, s) => {
  STARTS.push(acc);
  return acc + s.text.length;
}, 0);

function typedSlice(index: number, typed: number): string {
  const start = STARTS[index];
  const len = SEGMENTS[index].text.length;
  return SEGMENTS[index].text.slice(0, Math.max(0, Math.min(len, typed - start)));
}

export default function HeroTranslationDemo() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [typed, setTyped] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [target, setTarget] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);

  // Уважаем prefers-reduced-motion: вместо анимации — статичный финальный кадр
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Замеряем позицию слова "thirteen" внутри карточки — туда поедет курсор
  useEffect(() => {
    const measure = () => {
      const card = cardRef.current;
      const word = wordRef.current;
      if (!card || !word) return;
      const c = card.getBoundingClientRect();
      const w = word.getBoundingClientRect();
      setTarget({
        x: w.left - c.left + w.width / 2,
        y: w.top - c.top + w.height / 2,
        w: w.width,
        h: w.height,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Главная таймлайн-машина цикла; все таймеры чистятся на размонтировании/перезапуске
  useEffect(() => {
    if (reduced) {
      setPhase('hold');
      setTyped(TOTAL);
      setSaved(true);
      setPressed(false);
      return;
    }

    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };

    setPhase('idle');
    setTyped(0);
    setPressed(false);
    setSaved(false);

    const typingEnd = 3700 + TOTAL * TYPE_SPEED + 300;

    at(1300, () => setPhase('approach'));
    at(2050, () => setPhase('click'));
    at(2550, () => setPhase('thinking'));
    at(3700, () => setPhase('typing'));
    at(typingEnd, () => {
      setPhase('save');
      setPressed(true);
    });
    at(typingEnd + 280, () => {
      setPressed(false);
      setSaved(true);
      setPhase('saved');
    });
    at(typingEnd + 280 + 2400, () => setPhase('fade'));
    at(typingEnd + 280 + 2400 + 750, () => setCycle((c) => c + 1));

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [cycle, reduced]);

  // Печатная машинка
  useEffect(() => {
    if (phase !== 'typing' || reduced) return;
    const iv = window.setInterval(() => {
      setTyped((t) => {
        if (t >= TOTAL) {
          window.clearInterval(iv);
          return t;
        }
        return t + 1;
      });
    }, TYPE_SPEED);
    return () => window.clearInterval(iv);
  }, [phase, reduced]);

  const wordActive =
    phase === 'click' ||
    phase === 'thinking' ||
    phase === 'typing' ||
    phase === 'save' ||
    phase === 'saved' ||
    phase === 'hold';

  const cursorVisible = phase === 'approach' || phase === 'click';
  const showRest = phase === 'idle' || phase === 'approach' || phase === 'click';
  const showThinking = phase === 'thinking';
  const showCard =
    phase === 'typing' || phase === 'save' || phase === 'saved' || phase === 'hold';

  const cursorPos = target
    ? cursorVisible
      ? { x: target.x, y: target.y }
      : { x: target.x + 110, y: target.y + 100 }
    : null;

  // Индекс сегмента, который сейчас печатается (для каретки)
  const activeSegment =
    phase === 'typing'
      ? SEGMENTS.findIndex((_, i) => typed < STARTS[i] + SEGMENTS[i].text.length)
      : -1;

  const caret = (index: number) =>
    phase === 'typing' && activeSegment === index && typed > STARTS[index] ? (
      <span className="hero-caret text-primary">▎</span>
    ) : null;

  return (
    <div>
      <div
        ref={cardRef}
        className={`relative bg-canvas rounded-lg p-6 transition-opacity duration-slow ease-soft sm:p-10 ${
          phase === 'fade' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Шапка фрагмента читалки: книга и глава */}
        <div className="mb-5">
          <span className="text-caption text-slate">«1984» · Глава 1</span>
        </div>

        {/* Текст цитаты */}
        <div className="space-y-3">
          <p className="font-reading text-body-lg text-ink">
            It was a bright cold day in April, and the clocks were striking{' '}
            <span
              ref={wordRef}
              className={`rounded px-1 transition-colors duration-base ease-soft ${
                wordActive
                  ? 'bg-tint-yellow-bold text-ink'
                  : 'hero-word-invite text-ink'
              }`}
            >
              thirteen
            </span>
            .
          </p>
          <p className="text-body-sm text-slate italic">— George Orwell, «1984»</p>
        </div>

        {/* Зона перевода: фиксированная высота, чтобы карточка не прыгала */}
        <div className="relative mt-5 h-44">
          {/* Покой до клика: зона не должна выглядеть пустой дырой */}
          <div
            className={`absolute inset-0 flex items-center rounded-lg border border-dashed border-hairline-strong p-4 transition-opacity duration-slow ease-soft ${
              showRest ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <span className="text-body-sm text-slate">
              Здесь появится перевод слова с учётом контекста
            </span>
          </div>

          {/* ИИ думает */}
          <div
            className={`absolute inset-0 transition-opacity duration-slow ease-soft ${
              showThinking ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="h-full rounded-lg bg-surface-success p-4 flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="hero-dot h-2 w-2 rounded-full bg-primary"></span>
                <span className="hero-dot h-2 w-2 rounded-full bg-primary"></span>
                <span className="hero-dot h-2 w-2 rounded-full bg-primary"></span>
              </span>
              <span className="text-body-sm text-on-success">ИИ анализирует контекст…</span>
            </div>
          </div>

          {/* Карточка перевода */}
          <div
            className={`absolute inset-0 rounded-lg bg-surface-success p-4 transition-opacity duration-slow ease-soft ${
              showCard ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-h3 text-ink">
                {typedSlice(0, typed)}
                {caret(0)}
              </span>
              <span className="text-caption text-on-success">
                {typedSlice(1, typed)}
                {caret(1)}
              </span>
            </div>
            <p className="text-body text-primary font-medium">
              {typedSlice(2, typed)}
              {caret(2)}
            </p>
            <p className="mt-1.5 text-caption text-on-success leading-snug">
              {typedSlice(3, typed)}
              {caret(3)}
            </p>
            <button
              type="button"
              tabIndex={-1}
              className={`mt-2.5 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-body-sm font-medium transition-[background-color,color,transform] duration-base ease-soft ${
                pressed ? 'scale-97' : 'scale-100'
              } ${
                saved
                  ? 'bg-primary text-on-primary'
                  : 'bg-canvas text-primary'
              }`}
            >
              {saved ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
              {saved ? 'В словаре' : 'В словарь'}
            </button>
          </div>
        </div>

        {/* Ripple по клику */}
        {phase === 'click' && target && (
          <span
            className="hero-ripple absolute z-10 rounded-full border-2 border-primary pointer-events-none"
            style={{
              left: target.x,
              top: target.y,
              width: Math.max(target.w + 12, 32),
              height: Math.max(target.h + 10, 32),
            }}
          />
        )}

        {/* Анимированный курсор-касание */}
        {cursorPos && !reduced && (
          <div
            className="absolute z-20 left-0 top-0 pointer-events-none"
            style={{
              transform: `translate(${cursorPos.x}px, ${cursorPos.y}px)`,
              opacity: cursorVisible ? 1 : 0,
              transition: cursorVisible
                ? 'transform 750ms ease-in-out, opacity 400ms ease-in-out'
                : 'opacity 500ms ease-in-out',
            }}
          >
            <div
              className={`-translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-surface-accent border-2 border-primary transition-transform duration-fast ease-soft ${
                phase === 'click' ? 'scale-75' : 'scale-100'
              }`}
            />
          </div>
        )}
      </div>

      {/* Продающая подпись под карточкой */}
      <p className="mt-5 max-w-measure text-body-sm text-slate">
        Нажмите на любое слово в книге — ИИ переведёт его с учётом контекста
        и бережно сохранит в ваш личный словарь.
      </p>
    </div>
  );
}
