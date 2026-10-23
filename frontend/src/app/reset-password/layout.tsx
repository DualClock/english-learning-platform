import type { Metadata } from 'next';

/* Одноразовая страница из письма: доступ к ней и так привязан к ссылке. */
export const metadata: Metadata = {
  title: 'Новый пароль',
  description: 'Установка нового пароля для аккаунта Lexicon по ссылке из письма.',
  robots: { index: false, follow: false },
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
