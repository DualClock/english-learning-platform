'use client';

import { useEffect, useRef, useState } from 'react';

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
      <span className="hero-caret text-[#356B52]">▎</span>
    ) : null;

  return (
    <div>
      <div
        ref={cardRef}
        className={`relative bg-white rounded-2xl border border-[#D6D3CC] p-8 shadow-sm transition-opacity duration-700 ${
          phase === 'fade' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Бар мини-окна читалки */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#B85C5C]"></div>
            <div className="w-3 h-3 rounded-full bg-[#EBCB75]"></div>
            <div className="w-3 h-3 rounded-full bg-[#4A7C59]"></div>
          </div>
          <span className="text-xs text-[#5A5F5A] bg-[#F7F5EF] border border-[#D6D3CC] rounded-full px-3 py-1">
            «1984» · Глава 1
          </span>
        </div>

        {/* Текст цитаты */}
        <div className="space-y-3 font-serif text-[#20231F]">
          <p className="text-lg leading-relaxed">
            It was a bright cold day in April, and the clocks were striking{' '}
            <span
              ref={wordRef}
              className={`px-1 rounded cursor-pointer transition-colors duration-300 ${
                wordActive
                  ? 'bg-[#EBCB75] shadow-[0_0_0_3px_rgba(235,203,117,0.45)]'
                  : 'hero-word-invite'
              }`}
            >
              thirteen
            </span>
            .
          </p>
          <p className="text-sm text-[#5A5F5A] italic">— George Orwell, «1984»</p>
        </div>

        {/* Зона перевода: фиксированная высота, чтобы карточка не прыгала */}
        <div className="relative h-[172px] mt-5">
          {/* ИИ думает */}
          <div
            className={`absolute inset-0 transition-opacity duration-500 ${
              showThinking ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="h-full p-4 bg-[#E7ECE4] rounded-lg flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="hero-dot w-2 h-2 rounded-full bg-[#356B52]"></span>
                <span className="hero-dot w-2 h-2 rounded-full bg-[#356B52]"></span>
                <span className="hero-dot w-2 h-2 rounded-full bg-[#356B52]"></span>
              </span>
              <span className="text-sm text-[#5A5F5A]">ИИ анализирует контекст…</span>
            </div>
          </div>

          {/* Карточка перевода */}
          <div
            className={`absolute inset-0 p-4 bg-[#E7ECE4] rounded-lg transition-opacity duration-500 ${
              showCard ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-[#20231F]">
                {typedSlice(0, typed)}
                {caret(0)}
              </span>
              <span className="text-xs text-[#5A5F5A]">
                {typedSlice(1, typed)}
                {caret(1)}
              </span>
            </div>
            <p className="text-[#356B52] font-medium">
              {typedSlice(2, typed)}
              {caret(2)}
            </p>
            <p className="mt-1.5 text-xs text-[#5A5F5A] leading-snug">
              {typedSlice(3, typed)}
              {caret(3)}
            </p>
            <button
              type="button"
              tabIndex={-1}
              className={`mt-2.5 inline-flex items-center gap-1.5 text-sm font-medium rounded-md px-3 py-1.5 transition-all duration-300 ${
                pressed ? 'scale-95' : 'scale-100'
              } ${
                saved
                  ? 'bg-[#356B52] text-white'
                  : 'bg-white/70 text-[#356B52] border border-[#356B52]/30'
              }`}
            >
              {saved ? '✓ В словаре' : '+ В словарь'}
            </button>
          </div>
        </div>

        {/* Ripple по клику */}
        {phase === 'click' && target && (
          <span
            className="hero-ripple absolute z-10 rounded-full border-2 border-[#356B52] pointer-events-none"
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
              className={`-translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-[#356B52]/25 border-2 border-[#356B52] transition-transform duration-150 ${
                phase === 'click' ? 'scale-75' : 'scale-100'
              }`}
            />
          </div>
        )}
      </div>

      {/* Продающая подпись под карточкой */}
      <p className="mt-5 text-sm text-[#5A5F5A] leading-relaxed">
        Нажмите на любое слово в книге — ИИ переведёт его с учётом контекста
        и бережно сохранит в ваш личный словарь.
      </p>
    </div>
  );
}
