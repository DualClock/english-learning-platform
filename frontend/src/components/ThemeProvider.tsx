'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeMode, applyTheme, readTheme, writeTheme } from '@/lib/theme';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Класс темы ставит pre-paint скрипт в layout. Провайдер нужен для двух вещей:
 * мгновенно переключать тему по выбору в настройках и следить за системной,
 * пока режим «Как в системе».
 */
export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    const saved = readTheme();
    setModeState(saved);
    applyTheme(saved);
  }, []);

  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    writeTheme(next);
    setModeState(next);
    applyTheme(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme вызван вне ThemeProvider');
  return ctx;
}
