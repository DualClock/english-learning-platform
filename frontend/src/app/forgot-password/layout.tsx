import type { Metadata } from 'next';

/* Восстановление доступа: страница-форма, в индексе ей не место. */
export const metadata: Metadata = {
  title: 'Забыли пароль',
  description:
    'Восстановление доступа к аккаунту Lexicon: письмо со ссылкой на новый пароль.',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
