'use client';

import { SessionProvider } from 'next-auth/react';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ServiceWorkerRegistrar />
      {children}
    </SessionProvider>
  );
}
