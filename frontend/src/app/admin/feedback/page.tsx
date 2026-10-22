import type { Metadata } from 'next';
import AdminFeedbackClient from './AdminFeedbackClient';

export const metadata: Metadata = {
  title: 'Отзывы беты — Lexicon',
  robots: { index: false, follow: false },
};

export default function AdminFeedbackPage() {
  return <AdminFeedbackClient />;
}
