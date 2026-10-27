import type { Metadata } from 'next';
import AdminArticlesClient from './AdminArticlesClient';

export const metadata: Metadata = {
  title: 'Статьи',
  robots: { index: false, follow: false },
};

export default function AdminArticlesPage() {
  return <AdminArticlesClient />;
}
