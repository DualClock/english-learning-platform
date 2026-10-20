'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';

interface WelcomeItem {
  type: 'words' | 'book' | 'lesson';
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  bookId?: number | null;
  unitId?: number | null;
  page?: number | null;
}

interface WelcomeData {
  daysSinceLastActivity: number;
  show: boolean;
  items: WelcomeItem[];
}

const DISMISS_KEY = 'welcome-back-dismissed';

function daysLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

function itemHref(item: WelcomeItem): string {
  if (item.type === 'book' && item.bookId != null) {
    return `/reader/${item.bookId}${item.page && item.page > 1 ? `?page=${item.page}` : ''}`;
  }
  if (item.type === 'lesson' && item.unitId != null) return `/grammar/${item.unitId}`;
  return '/review';
}

function ItemIcon({ type }: { type: WelcomeItem['type'] }) {
  const common = 'w-5 h-5';
  if (type === 'words') {
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m-12 5h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />
      </svg>
    );
  }
  if (type === 'book') {
    return (
      <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    );
  }
  return (
    <svg className={common} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

// Модалка «С возвращением!» — показывается на dashboard после длительного отсутствия.
// Список собирает бекенд (/api/welcome) из данных пользователя; «Не сейчас» глушит её до конца сессии.
export default function WelcomeBackModal() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<WelcomeData | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;

    (async () => {
      try {
        if (window.sessionStorage.getItem(DISMISS_KEY)) return;
        const res = await fetch(`${API_URL}/api/welcome`, {
          headers: { Authorization: `Bearer ${session?.accessToken}` },
        });
        if (!res.ok) return;
        const welcome: WelcomeData = await res.json();
        if (!cancelled && welcome.show && welcome.items.length > 0) {
          setData(welcome);
        }
      } catch {
        // модалка не критична — тихо пропускаем
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, session]);

  if (!data) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // sessionStorage недоступен — окно просто закроется
    }
    setData(null);
  };

  const go = (item: WelcomeItem) => {
    dismiss();
    router.push(itemHref(item));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-welcome-in"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="С возвращением"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-[var(--color-primary)] mb-1">
          Вас не было {daysLabel(data.daysSinceLastActivity)}
        </p>
        <h2 className="text-2xl font-bold text-[var(--color-ink)] font-heading mb-5">С возвращением!</h2>

        <ul className="space-y-2.5 mb-6">
          {data.items.map((item, i) => (
            <li
              key={`${item.type}-${item.title}`}
              className="animate-welcome-in"
              style={{ animationDelay: `${120 + i * 110}ms` }}
            >
              <button
                type="button"
                onClick={() => go(item)}
                className="w-full text-left p-3.5 rounded-xl border border-[var(--color-hairline-strong)] hover:border-[var(--color-primary)] hover:bg-[var(--color-tint-mint)] transition-colors flex items-center gap-3.5 group focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <span className="w-10 h-10 rounded-full bg-[var(--color-tint-mint)] text-[var(--color-primary)] flex items-center justify-center shrink-0">
                  <ItemIcon type={item.type} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-[var(--color-ink)] truncate">{item.title}</span>
                  {item.subtitle && (
                    <span className="block text-sm text-[var(--color-slate)] truncate">{item.subtitle}</span>
                  )}
                  {item.meta && (
                    <span className="block text-xs text-[var(--color-slate)] truncate">{item.meta}</span>
                  )}
                </span>
                <span className="text-[var(--color-slate)] group-hover:text-[var(--color-primary)] shrink-0 transition-colors" aria-hidden="true">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={dismiss}
          className="w-full py-2.5 text-[var(--color-slate)] hover:text-[var(--color-ink)] transition-colors"
        >
          Не сейчас
        </button>
      </div>
    </div>
  );
}
