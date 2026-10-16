'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from './Sidebar';

export default function AppLayout({
  children,
  fullWidth = false,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#D6D3CC] border-t-[#356B52] rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#F7F5EF]">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        <div className={fullWidth ? 'px-8 py-8' : 'max-w-5xl mx-auto px-8 py-8'}>
          {children}
        </div>
      </main>
    </div>
  );
}