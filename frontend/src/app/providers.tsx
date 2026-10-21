'use client';

import { SessionProvider } from 'next-auth/react';
import { MotionConfig } from 'motion/react';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Единая политика доступности анимаций: при prefers-reduced-motion
          движок сам отключает transform- и layout-переходы во всём дереве. */}
      <MotionConfig reducedMotion="user">
        <ServiceWorkerRegistrar />
        {children}
      </MotionConfig>
    </SessionProvider>
  );
}
