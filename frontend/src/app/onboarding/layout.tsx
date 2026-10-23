import type { Metadata } from 'next';

/*
 * Онбординг с регистрацией — служебный маршрут: метаданные в layout.tsx,
 * потому что page.tsx помечен 'use client'.
 */
export const metadata: Metadata = {
  title: 'Первые шаги',
  description:
    'Два шага настройки: уровень, цель и формат чтения — дальше Lexicon подбирает книги и повторения сам.',
  robots: { index: false, follow: false },
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
