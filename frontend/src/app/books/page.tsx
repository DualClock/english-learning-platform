'use client';

import AppLayout from '@/components/AppLayout';
import { API_URL } from '@/app/lib/api-url';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LevelChip, { normalizeLevel } from '@/components/library/LevelChip';
import MyBookCard, { type UserBook } from '@/components/library/MyBookCard';
import StoryCard, { type Story } from '@/components/library/StoryCard';
import ClassicCard, { type PopularBook } from '@/components/library/ClassicCard';

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

function pluralBooks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} книга`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} книги`;
  return `${n} книг`;
}

interface Toast {
  text: string;
  kind: 'ok' | 'err';
}

export default function BooksPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [books, setBooks] = useState<UserBook[]>([]);
  const [popular, setPopular] = useState<PopularBook[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [profileLevel, setProfileLevel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
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

  const authHeaders = useCallback(
    (): Record<string, string> =>
      session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {},
    [session]
  );

  const reloadBooks = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/books`, { headers: authHeaders() });
      if (res.ok) setBooks(await res.json());
    } catch {
      // тихо: основная загрузка уже сообщила об ошибке сети
    }
  }, [authHeaders]);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const [booksRes, popularRes, storiesRes, profileRes] = await Promise.all([
          fetch(`${API_URL}/api/books`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/books/popular`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/books/stories`, { headers: authHeaders() }),
          fetch(`${API_URL}/api/profile`, { headers: authHeaders() }),
        ]);

        if (!booksRes.ok) throw new Error('books');
        const loadedBooks: UserBook[] = await booksRes.json();
        setBooks(loadedBooks);

        if (popularRes.ok) setPopular(await popularRes.json());
        if (storiesRes.ok) setStories(await storiesRes.json());
        if (profileRes.ok) {
          const profile = await profileRes.json();
          setProfileLevel(profile?.cefrLevel ?? '');
        }

        // Если у каких-то книг нет обложки — просим бэкенд подтянуть их (один раз за сессию страницы)
        if (!coverRefreshRef.current && loadedBooks.some((b) => !b.coverUrl)) {
          coverRefreshRef.current = true;
          try {
            const res = await fetch(`${API_URL}/api/books/refresh-covers`, {
              method: 'POST',
              headers: authHeaders(),
            });
            if (res.ok) {
              const data = await res.json().catch(() => null);
              if (data?.updated > 0) await reloadBooks();
            }
          } catch {
            // обложки не критичны — молча пропускаем
          }
        }
      } catch {
        setError('Не удалось загрузить библиотеку. Попробуйте обновить страницу.');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [status, authHeaders]);

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
      const res = await fetch(`${API_URL}/api/books/popular/${book.gutenbergId}`, {
        method: 'POST',
        headers: authHeaders(),
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
      const res = await fetch(`${API_URL}/api/books/story/${story.index}`, {
        method: 'POST',
        headers: authHeaders(),
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
      await fetch(`${API_URL}/api/books/${book.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setBooks((prev) => prev.filter((b) => b.id !== book.id));
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
      const res = await fetch(`${API_URL}/api/books/upload`, {
        method: 'POST',
        headers: authHeaders(),
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

  return (
    <AppLayout>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-ink)]">Библиотека</h1>
          <p className="mt-1 text-[var(--color-slate)]">Читайте то, что по силам — и чуть сложнее</p>
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && <span className="text-sm text-[var(--color-slate)]">{pluralBooks(books.length)}</span>}
          <label className="btn-secondary flex cursor-pointer items-center gap-2 px-4 py-2 text-sm">
            {uploading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)]" />
                Загрузка…
              </>
            ) : (
              <>
                <span className="text-base font-bold leading-none text-[var(--color-primary)]">+</span>
                Загрузить свою книгу
              </>
            )}
            <input
              type="file"
              accept=".epub"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-[var(--color-error)] bg-[rgba(217,45,32,0.10)] p-4 text-[var(--color-error)]">
          {error}
        </div>
      )}

      {isLoading ? (
        <div>
          <div className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-[var(--color-hairline-strong)] bg-white p-3">
                <div className="aspect-[2/3] w-full rounded-xl bg-[var(--color-tint-mint)]" />
                <div className="mt-3 h-3 w-full rounded bg-[var(--color-tint-mint)]" />
                <div className="mt-2 h-3 w-2/3 rounded bg-[var(--color-tint-mint)]" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl border border-[var(--color-hairline-strong)] bg-white p-4">
                <div className="flex h-full items-center gap-4">
                  <div className="h-20 w-14 shrink-0 rounded-lg bg-[var(--color-tint-mint)]" />
                  <div className="flex-1">
                    <div className="h-4 w-2/3 rounded bg-[var(--color-tint-mint)]" />
                    <div className="mt-2 h-3 w-full rounded bg-[var(--color-tint-mint)]" />
                    <div className="mt-2 h-3 w-1/2 rounded bg-[var(--color-tint-mint)]" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {books.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">Мои книги</h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                {books.map((book) => (
                  <MyBookCard
                    key={book.id}
                    book={book}
                    onOpen={openBook}
                    onDelete={deleteBook}
                  />
                ))}
              </div>
            </section>
          )}

          {books.length === 0 && (
            <div className="mb-10 rounded-2xl border border-dashed border-[var(--color-hairline-strong)] bg-white/60 p-8 text-center">
              <p className="font-medium text-[var(--color-ink)]">В библиотеке пока пусто</p>
              <p className="mt-1 text-sm text-[var(--color-slate)]">
                Начните с рассказа для вашего уровня ниже — или загрузите свой EPUB.
              </p>
            </div>
          )}

          {stories.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">
                Рассказы для вашего уровня
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
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
              <h2 className="mb-4 text-xl font-semibold text-[var(--color-ink)]">Классика по уровням</h2>
              {classicGroups.map(({ level, items }) => {
                const recommended = userLevel === level;
                return (
                  <div
                    key={level}
                    className={`relative mb-8 rounded-2xl p-4 ${
                      recommended ? 'bg-[rgba(249,231,159,0.10)] ring-2 ring-[var(--color-tint-yellow-bold)]' : ''
                    }`}
                  >
                    {recommended && (
                      <span className="absolute -top-3 left-4 rounded-full bg-[var(--color-tint-yellow-bold)] px-3 py-1 text-xs font-semibold text-[var(--color-ink)] shadow-sm">
                        для вас
                      </span>
                    )}
                    <div className="mb-4 flex items-center gap-2">
                      <LevelChip level={level} />
                      <h3 className="font-semibold text-[var(--color-ink)]">
                        {level} — {LEVEL_CAPTIONS[level]}
                      </h3>
                      <span className="text-sm text-[var(--color-slate)]">{items.length}</span>
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
                <div className="mb-8 rounded-2xl p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--color-ink)]">Без указания уровня</h3>
                    <span className="text-sm text-[var(--color-slate)]">{uncategorized.length}</span>
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

          {classicGroups.length === 0 && uncategorized.length === 0 && stories.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--color-hairline-strong)] bg-white/60 p-8 text-center">
              <p className="font-medium text-[var(--color-ink)]">Каталог пока недоступен</p>
              <p className="mt-1 text-sm text-[var(--color-slate)]">
                Загрузите свою книгу в формате EPUB — она появится в разделе «Мои книги».
              </p>
            </div>
          )}
        </>
      )}

      {toast && (
        <div
          className={`animate-fade-in fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'ok' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-error)] text-white'
          }`}
        >
          {toast.text}
        </div>
      )}
    </AppLayout>
  );
}
