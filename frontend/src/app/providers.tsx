'use client';

import { SessionProvider } from 'next-auth/react';
import { MotionConfig } from 'motion/react';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import AttributionCapture from '@/components/AttributionCapture';
import ThemeProvider from '@/components/ThemeProvider';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider refetchWhenOffline={false}>
      {/* Единая политика доступности анимаций: при prefers-reduced-motion
          движок сам отключает transform- и layout-переходы во всём дереве. */}
      <MotionConfig reducedMotion="user">
        <ThemeProvider>
          <ServiceWorkerRegistrar />
          {/* utm-метки и ?ref= ловятся на любой странице: человек может прийти
              на /books из поста в VK, а зарегистрироваться через неделю */}
          <AttributionCapture />
          {children}
          <FeedbackWidget />
        </ThemeProvider>
      </MotionConfig>
    </SessionProvider>
  );
}
