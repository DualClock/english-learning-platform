import type { Metadata } from 'next';
import AdminCategoriesClient from './AdminCategoriesClient';

export const metadata: Metadata = {
  title: 'Категории и слова',
  robots: { index: false, follow: false },
};

export default function AdminCategoriesPage() {
  return <AdminCategoriesClient />;
}
