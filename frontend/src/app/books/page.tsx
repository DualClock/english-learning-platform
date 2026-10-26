'use client';

import AppLayout from '@/components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Badge from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/LoadingState';
import { BooksIcon, CheckIcon, AlertIcon, UploadIcon, SpinnerIcon } from '@/components/ui/icons';
import { invalidateCache } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import { AnimatePresence, motion } from 'motion/react';
import { transition, variants } from '@/lib/motion';
import { pluralBooks } from '@/lib/plural';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LevelChip, { normalizeLevel } from '@/components/ui/LevelChip';
import MyBookCard, { type UserBook } from '@/components/library/MyBookCard';
import StoryCard, { type Story } from '@/components/library/StoryCard';
import ClassicCard, { type PopularBook } from '@/components/library/ClassicCard';
import Pager from '@/components/Pager';
import type { Paged } from '@/app/lib/paged';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

const LEVEL_CAPTIONS: Record<string, string> = {
  A1: 'лёгкое',
  A2: 'лёгкое',
  B1: 'среднее',
  B2: 'среднее',
  C1: 'сложное',
};

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface Toast {
  text: string;
  kind: 'ok' | 'err';
}

export default function BooksPage() {
  const { status } = useSession();
  const router = useRouter();

  const [page, setPage] = useState(1);

  const {
    data: booksData,
    error: booksError,
    isLoading: booksLoading,
    refresh: refreshBooks,
  } = useApiQuery<Paged<UserBook>>(`/api/books?page=${page}&pageSize=100`);
  const { data: popularData } = useApiQuery<PopularBook[]>('/api/books/popular');
  const { data: storiesData } = useApiQuery<Story[]>('/api/books/stories');
  const { data: profileData } = useApiQuery<{ cefrLevel?: string | null }>('/api/profile');

  const books = useMemo(() => booksData?.items ?? [], [booksData]);
  const totalCount = booksData?.totalCount ?? 0;
  const totalPages = booksData?.totalPages ?? 1;
  const popular = useMemo(() => popularData ?? [], [popularData]);
  const stories = useMemo(() => storiesData ?? [], [storiesData]);
  const profileLevel = profileData?.cefrLevel ?? '';
  const isLoading = booksLoading && booksData === undefined;
  const error = booksError ? 'Не удалось загрузить библиотеку. Попробуйте обновить страницу.' : '';

  const [addingPopularId, setAddingPopularId] = useState<string | null>(null);
  const [addingStoryIndex, setAddingStoryIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coverRefreshRef = useRef(false);

  const showToast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // Тост живёт дольше, чем страница: таймер снимаем при размонтировании
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );


  const reloadBooks = useCallback(async () => {
    invalidateCache('/api/books');
    refreshBooks();
  }, [refreshBooks]);

  // Если у каких-то книг нет обложки — просим бэкенд подтянуть их (один раз за сессию страницы)
  useEffect(() => {
    if (status !== 'authenticated' || booksData === undefined) return;
    if (coverRefreshRef.current || !books.some((b) => !b.coverUrl)) return;
    coverRefreshRef.current = true;

    const refreshCovers = async () => {
      try {
        const res = await fetch(`/api/next/api/books/refresh-covers`, {
          method: 'POST',
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.updated > 0) await reloadBooks();
        }
      } catch {
        // обложки не критичны — молча пропускаем
      }
    };
    void refreshCovers();
  }, [status, books, reloadBooks]);

  const userLevel = normalizeLevel(profileLevel);

  const classicGroups = LEVELS.map((level) => ({
    level,
    items: popular.filter((b) => normalizeLevel(b.cefrLevel) === level),
  })).filter((g) => g.items.length > 0);

  const uncategorized = popular.filter(
    (b) => !(LEVELS as readonly string[]).includes(normalizeLevel(b.cefrLevel))
  );

  const isInLibrary = useCallback(
    (title: string) => books.some((b) => sameTitle(b.title, title)),
    [books]
  );

  // Каталог пуст: показывать два пустых блока подряд незачем —
  // «Каталог пока недоступен» с загрузкой EPUB закрывает оба случая.
  const catalogEmpty = classicGroups.length === 0 && uncategorized.length === 0 && stories.length === 0;

  const findStoryBookId = useCallback(
    (story: Story): number | null => {
      const match = books.find((b) => sameTitle(b.title, story.title));
      return match ? match.id : null;
    },
    [books]
  );

  const openBook = useCallback(
    (id: number) => {
      router.push(`/reader/${id}`);
    },
    [router]
  );

  const addPopularBook = async (book: PopularBook) => {
    setAddingPopularId(book.gutenbergId);
    try {
      /*
       * ВАЖНО: путь к прокси — `/api/next/books/...`, без второго `/api`.
       *
       * Прокси сам строит адрес как `${API_URL}/api/${path}` (см.
       * app/api/next/[...path]/route.ts, buildTargetUrl). Лишний `/api` в
       * аргументе давал запрос на `/api/api/books/popular/84` — 404, и
       * «добавить книгу» молча не работало (нашёл в логе фронта).
       */
      const res = await fetch(`/api/next/books/popular/${book.gutenbergId}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('failed');
      await reloadBooks();
      showToast(`«${book.title}» добавлена в библиотеку`);
    } catch {
      showToast('Не удалось добавить книгу', 'err');
    } finally {
      setAddingPopularId(null);
    }
  };

  const addStory = async (story: Story) => {
    setAddingStoryIndex(story.index);
    try {
      const res = await fetch(`/api/next/api/books/story/${story.index}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('failed');
      const created = await res.json().catch(() => null);
      if (created?.id) {
        router.push(`/reader/${created.id}`);
        return;
      }
      await reloadBooks();
      showToast('Рассказ добавлен в библиотеку');
    } catch {
      showToast('Не удалось добавить рассказ', 'err');
    } finally {
      setAddingStoryIndex(null);
    }
  };

  const deleteBook = async (book: UserBook) => {
    try {
      await fetch(`/api/next/api/books/${book.id}`, {
        method: 'DELETE',
      });
      await reloadBooks();
      showToast('Книга удалена');
    } catch {
      showToast('Не удалось удалить книгу', 'err');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.epub')) {
      showToast('Поддерживается только формат EPUB', 'err');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/next/api/books/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Ошибка загрузки');
      }
      await reloadBooks();
      showToast('Книга загружена');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Ошибка загрузки файла', 'err');
    } finally {
      setUploading(false);
    }
  };

  // Файловый инпут остаётся в дереве доступности (sr-only, а не display:none):
  // label не является контролом, и без фокусируемого input загрузка
  // была бы недоступна с клавиатуры.
  const uploadButton = (variant: 'primary' | 'secondary') => (
    <label
      className={`${
        variant === 'primary' ? 'btn-primary' : 'btn-secondary'
      } cursor-pointer focus-within:ring-2 focus-within:ring-primary focus-within:ring-opacity-20`}
    >
      {uploading ? <SpinnerIcon size={16} /> : <UploadIcon size={16} />}
      {uploading ? 'Загрузка…' : 'Загрузить свою книгу'}
      <input
        type="file"
        accept=".epub"
        onChange={handleFileUpload}
        disabled={uploading}
        className="sr-only"
      />
    </label>
  );

  return (
    <AppLayout>
      <PageHeader
        title="Библиотека"
        subtitle="Читайте то, что по силам — и чуть сложнее"
        actions={
          <>
            {!isLoading && (
              <span className="text-body-sm tabular-nums text-slate">
                {totalCount} {pluralBooks(totalCount)}
              </span>
            )}
            {uploadButton('secondary')}
          </>
        }
      />

      {/* Живая область смонтирована заранее: появляющийся вместе с текстом
          region экранные читатели обычно не объявляют. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 md:justify-end md:px-6"
      >
        <AnimatePresence initial={false}>
          {toast && (
            <motion.div
              key={toast.text}
              variants={variants.enter}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-3 text-body-sm font-medium shadow-card ${
                toast.kind === 'ok'
                  ? 'border-hairline bg-canvas text-ink'
                  : 'border-semantic-error bg-surface-danger text-on-danger'
              }`}
            >
              {toast.kind === 'ok' ? (
                <CheckIcon size={20} className="shrink-0 text-semantic-success" />
              ) : (
                <AlertIcon size={20} className="shrink-0" />
              )}
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <div className="mb-8">
          <ErrorState
            title="Библиотека не загрузилась"
            description={error}
            onRetry={reloadBooks}
          />
        </div>
      )}

      {isLoading ? (
        <LibrarySkeleton />
      ) : (
        <>
          {books.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-baseline gap-2">
                <h2 className="text-h2 text-ink">Мои книги</h2>
                <span className="text-caption tabular-nums text-slate">
                  {books.length} {pluralBooks(books.length)}
                </span>
              </div>
              <motion.ul
                className="stagger grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5"
                initial={false}
              >
                <AnimatePresence initial={false}>
                  {books.map((book) => (
                    <motion.li
                      key={book.id}
                      exit={{ opacity: 0, scale: 0.96, transition: transition.fast }}
                    >
                      <MyBookCard book={book} onOpen={openBook} onDelete={deleteBook} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
              <Pager
                page={page}
                totalPages={totalPages}
                onPageChange={(next) => {
                  setPage(next);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </section>
          )}

          {books.length === 0 && !catalogEmpty && (
            <div className="mb-10">
              <EmptyState
                lexi="stand"
                title="В библиотеке пока пусто"
                description="Начните с рассказа для вашего уровня ниже — или загрузите свой EPUB."
              />
            </div>
          )}

          {stories.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 text-h2 text-ink">Рассказы для вашего уровня</h2>
              <div className="stagger grid gap-4 md:grid-cols-2">
                {stories.map((story) => (
                  <StoryCard
                    key={story.index}
                    story={story}
                    addedBookId={findStoryBookId(story)}
                    adding={addingStoryIndex === story.index}
                    onAdd={addStory}
                    onOpen={openBook}
                  />
                ))}
              </div>
            </section>
          )}

          {classicGroups.length > 0 && (
            <section>
              <h2 className="mb-4 text-h2 text-ink">Классика по уровням</h2>
              {classicGroups.map(({ level, items }) => {
                const recommended = userLevel === level;
                return (
                  <div key={level} className="mb-8">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                      <LevelChip level={level} />
                      <h3 className="text-body-lg font-semibold text-ink">
                        {level} — {LEVEL_CAPTIONS[level]}
                      </h3>
                      <span className="text-caption tabular-nums text-slate">{items.length}</span>
                      {/* Уровень отмечен плашкой, а не тонированным блоком:
                          заливать целую секцию пастелью нельзя — под ней
                          исчезнут hairline-границы карточек */}
                      {recommended && <Badge tone="accent">для вас</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                      {items.map((book) => (
                        <ClassicCard
                          key={book.gutenbergId}
                          book={book}
                          inLibrary={isInLibrary(book.title)}
                          adding={addingPopularId === book.gutenbergId}
                          onAdd={addPopularBook}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {uncategorized.length > 0 && (
                <div className="mb-8">
                  <div className="mb-4 flex items-center gap-2">
                    <h3 className="text-body-lg font-semibold text-ink">Без указания уровня</h3>
                    <span className="text-caption tabular-nums text-slate">{uncategorized.length}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                    {uncategorized.map((book) => (
                      <ClassicCard
                        key={book.gutenbergId}
                        book={book}
                        inLibrary={isInLibrary(book.title)}
                        adding={addingPopularId === book.gutenbergId}
                        onAdd={addPopularBook}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {catalogEmpty && (
            <EmptyState
              icon={<BooksIcon size={24} />}
              title="Каталог пока недоступен"
              description="Загрузите свою книгу в формате EPUB — она появится в разделе «Мои книги»."
              action={uploadButton('primary')}
            />
          )}
        </>
      )}
    </AppLayout>
  );
}

/** Заглушка совпадает с реальной сеткой: при замене контента строки не прыгают. */
function LibrarySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-10">
      <span className="sr-only">Загрузка библиотеки</span>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-2">
            <Skeleton className="aspect-book w-full" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <Skeleton className="mt-3 h-1 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card flex gap-4">
            <Skeleton className="aspect-book w-14 shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="mt-3 h-9 w-36" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
