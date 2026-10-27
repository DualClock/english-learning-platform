'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Notice from '@/components/ui/Notice';
import PageHeader from '@/components/ui/PageHeader';
import {
  AdminForbiddenError,
  deleteBook,
  listBooks,
  publishBook,
  restoreBook,
  uploadBook,
  type AdminBook,
} from './api';

/**
 * Список книг и управление видимостью.
 *
 * «Публичная» здесь значит «видна в гостевом каталоге»: гостевая витрина
 * читает строки Books без владельца. Поэтому публикация — это не флаг, а
 * снятие владельца; экран говорит об этом прямо, чтобы админ понимал, что
 * делает, а не жал кнопку наугад.
 */
export default function AdminBooksClient() {
  const [books, setBooks] = useState<AdminBook[] | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (withDeleted: boolean) => {
    setError(null);
    try {
      setBooks(await listBooks(withDeleted));
      setForbidden(false);
    } catch (e) {
      if (e instanceof AdminForbiddenError) {
        setForbidden(true);
        return;
      }
      setError(e instanceof Error ? e.message : 'Не удалось загрузить книги.');
    }
  }, []);

  useEffect(() => {
    void load(includeDeleted);
  }, [load, includeDeleted]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await load(includeDeleted);
      } catch (e) {
        if (e instanceof AdminForbiddenError) {
          setForbidden(true);
          return;
        }
        setError(e instanceof Error ? e.message : 'Действие не выполнено.');
      } finally {
        setBusy(false);
      }
    },
    [includeDeleted, load],
  );

  if (forbidden) {
    return (
      <EmptyState
        lexi="sleep"
        title="Нужны права администратора"
        description="Эта страница доступна только аккаунту с ролью Admin."
        action={<Button href="/dashboard" variant="secondary">Вернуться на главную</Button>}
      />
    );
  }

  if (books === null) {
    return <LoadingState label="Загружаем книги" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Книги"
        subtitle="Публичные книги видны без аккаунта в гостевом каталоге. Удаление мягкое — прогресс читателей сохраняется."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Загрузка EPUB: книга попадает сразу в общий каталог, без
                владельца — иначе она осела бы в личной библиотеке админа и
                её никто бы не увидел. */}
            <label
              className={`btn-primary inline-flex cursor-pointer items-center gap-2 ${
                busy ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              {busy ? 'Загрузка…' : 'Загрузить EPUB'}
              <input
                type="file"
                accept=".epub,application/epub+zip"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  void run(() => uploadBook(file));
                }}
              />
            </label>
            <Button variant="secondary" href="/admin/content/categories">
              К категориям
            </Button>
          </div>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      <label className="flex items-center gap-2 text-body-sm text-slate">
        <input
          type="checkbox"
          checked={includeDeleted}
          onChange={(e) => setIncludeDeleted(e.target.checked)}
          className="h-4 w-4"
        />
        Показать удалённые
      </label>

      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-body-sm">
          <thead className="bg-surface-soft text-left text-caption text-slate">
            <tr>
              <th className="px-3 py-2 font-semibold">Название</th>
              <th className="px-3 py-2 font-semibold">Уровень</th>
              <th className="px-3 py-2 font-semibold">Доступ</th>
              <th className="px-3 py-2 text-right font-semibold">Действия</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => {
              const isDeleted = b.deletedAt != null;
              return (
                <tr key={b.id} className={`border-t border-hairline-soft ${isDeleted ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-ink">{b.title}</div>
                    {b.author && <div className="text-caption text-steel">{b.author}</div>}
                  </td>
                  <td className="px-3 py-2 align-top text-slate">{b.cefrLevel ?? '—'}</td>
                  <td className="px-3 py-2 align-top">
                    {b.isPublic ? (
                      <span className="rounded-full bg-surface-success px-2 py-0.5 text-caption text-semantic-success">
                        публичная
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface-soft px-2 py-0.5 text-caption text-slate">
                        личная
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-2">
                      {!b.isPublic && !isDeleted && (
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-caption"
                          disabled={busy}
                          title="Снять владельца: книга появится в гостевом каталоге"
                          onClick={() => void run(() => publishBook(b.id))}
                        >
                          Опубликовать
                        </button>
                      )}
                      {isDeleted ? (
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-caption"
                          disabled={busy}
                          onClick={() => void run(() => restoreBook(b.id))}
                        >
                          Восстановить
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-caption text-semantic-error"
                          disabled={busy}
                          onClick={() => void run(() => deleteBook(b.id))}
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {books.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate">
                  Книг пока нет.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-caption text-steel">
        Проверить глазами:{' '}
        <Link href="/library" className="text-link underline">
          полка книг
        </Link>{' '}
        — там же, где их видят пользователи.
      </p>
    </div>
  );
}
