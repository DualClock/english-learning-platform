import type { Metadata } from 'next';
import AdminFeedbackClient from './AdminFeedbackClient';

export const metadata: Metadata = {
  // Бренд дописывает title.template из src/app/layout.tsx
  title: 'Отзывы беты',
  robots: { index: false, follow: false },
};

export default function AdminFeedbackPage() {
  return <AdminFeedbackClient />;
}
