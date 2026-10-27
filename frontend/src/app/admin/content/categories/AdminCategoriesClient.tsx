'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Notice from '@/components/ui/Notice';
import PageHeader from '@/components/ui/PageHeader';
import {
  AdminForbiddenError,
  createCategory,
  createWord,
  deleteCategory,
  deleteWord,
  deleteWordImage,
  listCategories,
  restoreCategory,
  restoreWord,
  updateWord,
  uploadWordImage,
  type AdminCategory,
  type AdminWord,
} from '../api';
import { uploadedImageSrc as wordImageSrc } from '@/components/dictionary/WordIllustration';
import WordImportPanel from './WordImportPanel';


/**
 * Управление категориями и словами.
 *
 * Экран сделан для основной задачи админа — «добавить слово в категорию» —
 * и старается не прятать последствия: удаление здесь мягкое, поэтому удалённое
 * остаётся доступным по переключателю «Показать удалённые», а у слова видно,
 * что его прогресс у пользователей сохранён.
 */
export default function AdminCategoriesClient() {
  const [categories, setCategories] = useState<AdminCategory[] | null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [wordForm, setWordForm] = useState({ english: '', translation: '', transcription: '', example: '' });
  // Панель импорта открыта для выбранной категории. Живёт рядом с формой
  // добавления слова: это то же действие — наполнить категорию, только оптом.
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async (withDeleted: boolean) => {
    setError(null);
    try {
      const data = await listCategories(withDeleted);
      setCategories(data);
      setForbidden(false);
      setSelectedId((current) => {
        if (current != null && data.some((c) => c.id === current)) return current;
        const firstActive = data.find((c) => c.deletedAt == null);
        return firstActive?.id ?? data[0]?.id ?? null;
      });
    } catch (e) {
      if (e instanceof AdminForbiddenError) {
        setForbidden(true);
        return;
      }
      setError(e instanceof Error ? e.message : 'Не удалось загрузить категории.');
    }
  }, []);

  useEffect(() => {
    void load(includeDeleted);
  }, [load, includeDeleted]);

  const selected = useMemo(
    () => categories?.find((c) => c.id === selectedId) ?? null,
    [categories, selectedId],
  );

  const run = useCallback(
    async (action: () => Promise<unknown>, after?: () => void) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        after?.();
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
        description="Эта страница доступна только аккаунту с ролью Admin. Войдите под администратором — или попросите выдать роль."
        action={<Button href="/dashboard" variant="secondary">Вернуться на главную</Button>}
      />
    );
  }

  if (categories === null) {
    return <LoadingState label="Загружаем категории" />;
  }

  const activeWords = selected?.words.filter((w) => w.deletedAt == null) ?? [];
  const deletedWords = selected?.words.filter((w) => w.deletedAt != null) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Категории и слова"
        subtitle="Изменения сразу видны пользователям: кэш витрин сбрасывается при каждом сохранении."
        actions={
          <Button variant="secondary" href="/admin/content">
            К книгам
          </Button>
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

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ─── Категории ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newCategoryName.trim();
              if (!name) return;
              void run(
                () => createCategory({ name }),
                () => setNewCategoryName(''),
              );
            }}
          >
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Новая категория"
              className="input flex-1"
              aria-label="Название новой категории"
            />
            <Button type="submit" disabled={busy || !newCategoryName.trim()}>
              Создать
            </Button>
          </form>

          <ul className="flex flex-col gap-1">
            {categories.map((c) => {
              const isSelected = c.id === selectedId;
              const isDeleted = c.deletedAt != null;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-body-sm transition ${
                      isSelected ? 'bg-surface-soft font-medium text-ink' : 'text-slate hover:bg-surface-soft'
                    } ${isDeleted ? 'opacity-60' : ''}`}
                  >
                    <span className="truncate">
                      {c.icon ? `${c.icon} ` : ''}
                      {c.name}
                    </span>
                    <span className="shrink-0 text-caption text-steel">
                      {c.words.filter((w) => w.deletedAt == null).length}
                    </span>
                  </button>
                </li>
              );
            })}
            {categories.length === 0 && (
              <li className="px-3 py-4 text-body-sm text-slate">Категорий пока нет.</li>
            )}
          </ul>
        </section>

        {/* ─── Слова выбранной категории ─────────────────────────────── */}
        <section className="flex flex-col gap-4">
          {!selected ? (
            <EmptyState
              lexi="read"
              title="Выберите категорию"
              description="Слова добавляются внутрь категории — выберите её слева или создайте новую."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-h3 text-ink">{selected.name}</h2>
                  <p className="text-caption text-steel">/{selected.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Импорт — только в живую категорию: заливка слов в удалённую
                      создала бы слова, которых никто не увидит. */}
                  {selected.deletedAt == null && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      aria-expanded={importOpen}
                      // Ссылку на панель даём только пока она в DOM: указывать
                      // на отсутствующий id для скринридера значит ломать навигацию.
                      aria-controls={importOpen ? 'word-import-panel' : undefined}
                      onClick={() => setImportOpen((open) => !open)}
                    >
                      {importOpen ? 'Скрыть импорт' : 'Импорт слов'}
                    </Button>
                  )}
                  {selected.deletedAt == null ? (
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void run(() => deleteCategory(selected.id))}
                    >
                      Удалить категорию
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void run(() => restoreCategory(selected.id))}
                    >
                      Восстановить категорию
                    </Button>
                  )}
                </div>
              </div>

              {importOpen && selected.deletedAt == null && (
                <div id="word-import-panel">
                  <WordImportPanel
                    // key по id: при переключении категории панель начинается
                    // с чистого состояния, а не с чужого результата.
                    key={selected.id}
                    categoryId={selected.id}
                    categoryName={selected.name}
                    onClose={() => setImportOpen(false)}
                    onForbidden={() => setForbidden(true)}
                    onImported={() => void load(includeDeleted)}
                  />
                </div>
              )}

              <form
                className="grid gap-2 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const english = wordForm.english.trim();
                  const translation = wordForm.translation.trim();
                  if (!english || !translation) return;
                  void run(
                    () =>
                      createWord(selected.id, {
                        english,
                        translation,
                        transcription: wordForm.transcription.trim() || null,
                        example: wordForm.example.trim() || null,
                      }),
                    () => setWordForm({ english: '', translation: '', transcription: '', example: '' }),
                  );
                }}
              >
                <input
                  className="input"
                  placeholder="Слово (english)"
                  aria-label="Слово"
                  value={wordForm.english}
                  onChange={(e) => setWordForm((f) => ({ ...f, english: e.target.value }))}
                />
                <input
                  className="input"
                  placeholder="Перевод"
                  aria-label="Перевод"
                  value={wordForm.translation}
                  onChange={(e) => setWordForm((f) => ({ ...f, translation: e.target.value }))}
                />
                <input
                  className="input"
                  placeholder="Транскрипция (необязательно)"
                  aria-label="Транскрипция"
                  value={wordForm.transcription}
                  onChange={(e) => setWordForm((f) => ({ ...f, transcription: e.target.value }))}
                />
                <input
                  className="input"
                  placeholder="Пример (необязательно)"
                  aria-label="Пример"
                  value={wordForm.example}
                  onChange={(e) => setWordForm((f) => ({ ...f, example: e.target.value }))}
                />
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    disabled={busy || !wordForm.english.trim() || !wordForm.translation.trim()}
                  >
                    Добавить слово
                  </Button>
                </div>
              </form>

              <div className="overflow-x-auto rounded-lg border border-hairline">
                <table className="w-full text-body-sm">
                  <thead className="bg-surface-soft text-left text-caption text-slate">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Слово</th>
                      <th className="px-3 py-2 font-semibold">Перевод</th>
                      <th className="px-3 py-2 font-semibold">Пример</th>
                      <th className="px-3 py-2 text-right font-semibold">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeWords.map((w) => (
                      <tr key={w.id} className="border-t border-hairline-soft">
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-start gap-2">
                            {/* Картинка слова: своя, если админ загрузил.
                                Превью доступно и без загрузки — видно, что
                                слот есть и что в нём лежит. */}
                            <div className="shrink-0">
                              {w.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={wordImageSrc(w.imageUrl)}
                                  alt={`Картинка: ${w.english}`}
                                  width={40}
                                  height={40}
                                  className="h-10 w-10 rounded-md border border-hairline object-cover"
                                />
                              ) : (
                                <span className="grid h-10 w-10 place-items-center rounded-md border border-dashed border-hairline-strong text-caption text-muted">
                                  нет
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-ink">{w.english}</div>
                              {w.transcription && (
                                <div className="text-caption text-steel">{w.transcription}</div>
                              )}
                              <div className="mt-1 flex items-center gap-2">
                                <label className="cursor-pointer text-caption text-link underline">
                                  {w.imageUrl ? 'Заменить фото' : 'Добавить фото'}
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    className="sr-only"
                                    disabled={busy}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = '';
                                      if (!file) return;
                                      void run(() => uploadWordImage(w.id, file));
                                    }}
                                  />
                                </label>
                                {w.imageUrl && (
                                  <button
                                    type="button"
                                    className="text-caption text-semantic-error underline"
                                    disabled={busy}
                                    onClick={() => void run(() => deleteWordImage(w.id))}
                                  >
                                    Убрать
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-slate">{w.translation}</td>
                        <td className="px-3 py-2 align-top text-caption text-steel">
                          {w.example ?? '—'}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-caption"
                              disabled={busy}
                              onClick={() => {
                                const translation = window.prompt('Новый перевод', w.translation);
                                if (translation == null || !translation.trim()) return;
                                void run(() =>
                                  updateWord(w.id, {
                                    english: w.english,
                                    translation: translation.trim(),
                                    transcription: w.transcription,
                                    example: w.example,
                                  }),
                                );
                              }}
                            >
                              Изменить
                            </button>
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-caption text-semantic-error"
                              disabled={busy}
                              onClick={() => void run(() => deleteWord(w.id))}
                            >
                              Удалить
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {activeWords.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-slate">
                          В категории пока нет слов.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {deletedWords.length > 0 && includeDeleted && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
                    Удалённые слова
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {deletedWords.map((w: AdminWord) => (
                      <li
                        key={w.id}
                        className="flex items-center justify-between gap-2 rounded-md bg-surface-soft px-3 py-2 text-body-sm"
                      >
                        <span className="text-slate line-through">{w.english}</span>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-caption"
                          disabled={busy}
                          onClick={() => void run(() => restoreWord(w.id))}
                        >
                          Восстановить
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-caption text-steel">
                    Удаление мягкое: прогресс пользователей по этим словам сохранён и вернётся
                    при восстановлении.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <p className="text-caption text-steel">
        Проверить глазами:{' '}
        <Link href="/categories" className="text-link underline">
          страница категорий
        </Link>{' '}
        — она читает те же данные, что и пользователи.
      </p>
    </div>
  );
}
