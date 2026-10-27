'use client';

import { useEffect, useState } from 'react';
import DoodleCrewFooter, {
  type CrewMember,
  type FooterAction,
  type FooterColumn,
  type FooterLink,
} from '@/components/ui/doodle-crew-footer';
import { openFeedback } from '@/components/feedback/events';

/*
 * Футер лендинга — клиентский, потому что кнопка «Оставить отзыв» открывает
 * модалку через событие: функцию нельзя передать из серверной страницы.
 * Всё остальное — данные: ссылки, экипаж и палитра тёмной секции.
 */

const COLUMNS: FooterColumn[] = [
  {
    title: 'Продукт',
    links: [
      { label: 'Возможности', href: '#skills' },
      { label: 'Библиотека', href: '#library' },
      { label: 'Когорта', href: '/beta' },
    ],
  },
  {
    title: 'Правовое',
    links: [
      { label: 'Конфиденциальность', href: '/privacy' },
      { label: 'Правила беты', href: '/terms' },
    ],
  },
  {
    title: 'Аккаунт',
    links: [
      { label: 'Войти', href: '/login' },
      { label: 'Регистрация', href: '/onboarding' },
    ],
  },
];

const CREW: CrewMember[] = [
  // Бруно стоит рядом с «L», а не на ней: иначе первая буква исчезает под ним
  { kind: 'yeti', letter: 0, seat: 'front', offset: -0.46, scale: 0.86, name: 'Бруно', says: 'Есть что пожевать?' },
  { kind: 'bird', letter: 1, seat: 'top', offset: 0.02, name: 'Пип', says: 'Напиши нам!' },
  { kind: 'mushroom', letter: 2, seat: 'front', offset: 0.14, scale: 0.95, name: 'Морель', says: 'Я тут по делу.' },
  { kind: 'kid', letter: 6, seat: 'top', offset: -0.05, name: 'Джуно', says: 'Лучшее место в зале!' },
  { kind: 'cat', letter: 4, seat: 'front', offset: 0.3, flip: true, name: 'Патч', says: 'Мяу. Хороший курсор.' },
  { kind: 'ghost', letter: 5, seat: 'behind', offset: 0, name: 'Бу', says: 'Бу! …ой, привет.' },
];

/*
 * На телефоне буквы высотой ~47px, а персонажи при том же масштабе закрывают
 * половину слова: «LEXICON» читается как «EXI..O..». Поэтому на узком экране
 * оставляем трёх героев на средних буквах и уменьшаем их — крайние «L» и «N»
 * остаются видны.
 */
const NARROW_CREW: CrewMember[] = [
  { kind: 'bird', letter: 1, seat: 'top', offset: 0.02, scale: 0.62, name: 'Пип', says: 'Напиши нам!' },
  { kind: 'mushroom', letter: 2, seat: 'front', offset: 0.12, scale: 0.58, name: 'Морель', says: 'Я тут по делу.' },
  { kind: 'cat', letter: 4, seat: 'front', offset: 0.26, scale: 0.62, flip: true, name: 'Патч', says: 'Мяу. Хороший курсор.' },
];

/** До 640px включительно — тот же порог, что у мобильной вёрстки лендинга. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  return narrow;
}

const ACTIONS: FooterAction[] = [
  { label: 'Начать бесплатно', href: '/onboarding', icon: 'bolt', variant: 'solid' },
  { label: 'Оставить отзыв', onClick: openFeedback, icon: 'sparkle', variant: 'outline' },
];

const SOCIALS: FooterLink[] = [{ label: 'hello@lexicon.app', href: 'mailto:hello@lexicon.app' }];

export default function LandingFooter() {
  const narrow = useNarrowViewport();

  return (
    <DoodleCrewFooter
      wordmark="LEXICON"
      brand="Lexicon"
      blurb="Читай книги на английском, собирай незнакомые слова и возвращай их в память в нужный момент."
      tagline="Читай. Учи. Помни."
      columns={COLUMNS}
      actions={ACTIONS}
      copyright="© 2026 Lexicon"
      legal={[]}
      socials={SOCIALS}
      backToTopLabel="Наверх"
      crew={narrow ? NARROW_CREW : CREW}
      preset="night"
      // Тёмная секция лендинга: navy-deep — её «земля», on-dark — чернила,
      // тёплый акцент держит рисунок рядом с персиковым героем.
      palette={{
        background: 'var(--color-navy-deep)',
        ink: 'var(--color-on-dark)',
        accent: '#ff8a3d',
      }}
      fontFamily="var(--font-manrope), Manrope, system-ui, sans-serif"
      serifFamily="var(--font-literata), Literata, Georgia, serif"
      height="clamp(560px, 62vw, 720px)"
    />
  );
}
