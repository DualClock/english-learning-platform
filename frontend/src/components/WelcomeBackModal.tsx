'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'motion/react';
import { API_URL } from '@/app/lib/api-url';
import Button from '@/components/ui/Button';
import {
  BookOpenIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  NotebookIcon,
  type IconProps,
} from '@/components/ui/icons';
import { transition, variants } from '@/lib/motion';
import { pluralDays } from '@/lib/plural';

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

/** Тип продолжения из бэкенда → иконка той же области приложения */
const ITEM_ICON: Record<WelcomeItem['type'], (props: IconProps) => JSX.Element> = {
  words: NotebookIcon,
  book: BookOpenIcon,
  lesson: CheckCircleIcon,
};

function itemHref(item: WelcomeItem): string {
  if (item.type === 'book' && item.bookId != null) {
    return `/reader/${item.bookId}${item.page && item.page > 1 ? `?page=${item.page}` : ''}`;
  }
  if (item.type === 'lesson' && item.unitId != null) return `/grammar/${item.unitId}`;
  return '/review';
}

// Модалка «С возвращением!» — показывается на dashboard после длительного отсутствия.
// Список собирает бекенд (/api/welcome) из данных пользователя; «Не сейчас» глушит её до конца сессии.
export default function WelcomeBackModal() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<WelcomeData | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // sessionStorage недоступен — окно просто закроется
    }
    setData(null);
  };

  // Диалог забирает фокус и закрывается с Escape: иначе клавиатура остаётся на странице под затемнением.
  useEffect(() => {
    if (!data) return;
    cardRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [data]);

  const go = (item: WelcomeItem) => {
    dismiss();
    router.push(itemHref(item));
  };

  return (
    <AnimatePresence>
      {data && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-4 md:items-center"
          variants={variants.overlay}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={dismiss}
        >
          <motion.div
            ref={cardRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-back-title"
            onClick={(e) => e.stopPropagation()}
            className="card max-h-[85vh] w-full max-w-md overflow-y-auto p-6 text-left shadow-modal outline-none"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={transition.base}
          >
            <h2 id="welcome-back-title" className="text-h2 text-ink">
              С возвращением!
            </h2>
            <p className="mt-1 text-body-sm text-slate">
              Вас не было {data.daysSinceLastActivity} {pluralDays(data.daysSinceLastActivity)}
            </p>

            <motion.ul
              variants={variants.list}
              initial="hidden"
              animate="visible"
              className="mt-6 space-y-2"
            >
              {data.items.map((item) => {
                const Icon = ITEM_ICON[item.type] ?? NotebookIcon;
                return (
                  <motion.li key={`${item.type}-${item.title}`} variants={variants.item}>
                    <button
                      type="button"
                      onClick={() => go(item)}
                      className="group flex w-full items-center gap-3 rounded-lg border border-hairline-strong bg-canvas p-3 text-left transition-[background-color,border-color,transform] duration-fast ease-soft hover:border-primary hover:bg-surface active:scale-97"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
                        <Icon size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm font-medium text-ink">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="block truncate text-caption text-slate">
                            {item.subtitle}
                          </span>
                        )}
                        {item.meta && (
                          <span className="block truncate text-caption text-slate">{item.meta}</span>
                        )}
                      </span>
                      <ChevronRightIcon
                        size={16}
                        className="shrink-0 text-slate transition-colors duration-fast group-hover:text-primary"
                      />
                    </button>
                  </motion.li>
                );
              })}
            </motion.ul>

            <Button variant="ghost" className="mt-4 w-full" onClick={dismiss}>
              Не сейчас
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
