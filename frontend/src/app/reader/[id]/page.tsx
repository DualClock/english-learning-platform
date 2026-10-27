'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppLayout from '@/components/AppLayout';
import ReaderShell from '@/components/reader/ReaderShell';

export default function ReaderPage() {
  const { data: session } = useSession();
  const params = useParams();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const bookId = Number(rawId);

  return (
    <AppLayout immersive>
      <ReaderShell
        bookId={Number.isInteger(bookId) && bookId > 0 ? bookId : 0}
        userId={session?.user?.id ?? null}
      />
    </AppLayout>
  );
}
