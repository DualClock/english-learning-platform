import type { Metadata } from 'next';
import AdminBooksClient from './AdminBooksClient';

export const metadata: Metadata = {
  title: 'Книги',
  robots: { index: false, follow: false },
};

export default function AdminBooksPage() {
  return <AdminBooksClient />;
}
