import type { Metadata } from 'next';

/* Подтверждение почты из письма: страница без контента для поиска. */
export const metadata: Metadata = {
  title: 'Подтверждение почты',
  description: 'Подтверждение адреса электронной почты после регистрации в Lexicon.',
  robots: { index: false, follow: false },
};

export default function ConfirmEmailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
