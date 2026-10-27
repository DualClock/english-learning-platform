'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Notice from '@/components/ui/Notice';
import PageHeader from '@/components/ui/PageHeader';
import { Tag } from '@/components/ui/Badge';
import { SearchIcon } from '@/components/ui/icons';
import {
  articleFormInput,
  articlePublicPath,
  articleStatusTone,
  formatArticleDate,
  isValidArticleSlug,
  normalizeArticleStatus,
  statusLabel,
  type ArticleFormState,
} from '@/lib/articles';
import { AdminForbiddenError } from '../api';
import ArticleAssistant from './ArticleAssistant';
import MarkdownField from './MarkdownField';
import {
  archiveArticle,
  createArticle,
  deleteArticle,
  getArticle,
  listArticleSections,
  listArticles,
  publishArticle,
  restoreArticle,
  updateArticle,
  type AdminArticleDetail,
  type AdminArticleList,
  type AdminArticleRow,
  type ArticleSectionOption,
} from './articles-api';

/*
 * Управление статьями.
 *
 * Экран делает одну работу: найти статью, поправить её и решить, видит ли её
 * читатель. Четыре решения, которые видны в вёрстке:
 *
 *  1. Тело статьи — markdown, и его можно смотреть глазами до сохранения:
 *     переключатель «Редактор / Просмотр» собирает HTML на клиенте тем же
 *     безопасным рендерером, что покрыт XSS-тестами (`lib/markdown-preview`).
 *     Серверный HTML для живой формы недоступен — он есть только у сохранённой
 *     статьи, поэтому предпросмотр честно подписан как наш, а не серверный.
 *  2. Черновик умеет писать ассистент, но он только ЗАПОЛНЯЕТ поля: сохранение
 *     и публикация остаются отдельными шагами. Иначе один клик по ИИ выпускал
 *     бы текст, который никто не читал.
 *  3. Публикация — отдельный шаг, а не галочка в форме. Создание всегда даёт
 *     черновик, и админ должен видеть разницу между «сохранил» и «выпустил».
 *  4. Удаление мягкое: удалённое возвращается кнопкой «Восстановить», которая
 *     видна только после включения «Показать удалённые» (фильтр статуса
 *     остаётся главным: архив — это не удаление).
 */

const EMPTY_FORM: ArticleFormState = {
  title: '',
  slug: '',
  summary: '',
  sectionId: '',
  bodyMarkdown: '',
};

/** Подпись фильтра → значение для ручки. `null` — без фильтра. */
const STATUS_FILTERS: { label: string; value: string | null }[] = [
  { label: 'Все', value: null },
  { label: 'Черновики', value: 'draft' },
  { label: 'Опубликованные', value: 'published' },
  { label: 'Архив', value: 'archived' },
];

interface EditorState {
  /** id правимой статьи; null — создаём новую. */
  id: number | null;
  form: ArticleFormState;
  /** Slug, с которым статья уже лежит на сервере: его не трогаем без просьбы. */
  originalSlug: string;
  originalTitle: string;
}

export default function AdminArticlesClient() {
  const [feed, setFeed] = useState<AdminArticleList | null>(null);
  const [sections, setSections] = useState<ArticleSectionOption[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** Применённый поиск: отличать «набрал» от «отправил» — иначе запрос на каждый символ. */
  const [appliedSearch, setAppliedSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const load = useCallback(
    async (statusFilter: string | null, query: string) => {
      setError(null);
      try {
        const data = await listArticles({ status: statusFilter, search: query });
        setFeed(data);
        setForbidden(false);
      } catch (e) {
        if (e instanceof AdminForbiddenError) {
          setForbidden(true);
          return;
        }
        setError(e instanceof Error ? e.message : 'Не удалось загрузить статьи.');
      }
    },
    []
  );

  useEffect(() => {
    void load(status, appliedSearch);
  }, [load, status, appliedSearch]);

  useEffect(() => {
    let cancelled = false;
    listArticleSections()
      .then((options) => {
        if (!cancelled) setSections(options);
      })
      .catch(() => {
        // Список разделов не критичен: без него статья сохраняется без раздела.
        if (!cancelled) setSections([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        setNotice(success);
        await load(status, appliedSearch);
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
    [appliedSearch, load, status]
  );

  const openEditor = useCallback(
    async (row: AdminArticleRow | null) => {
      setEditorError(null);
      setNotice(null);

      if (row === null) {
        setEditor({
          id: null,
          form: EMPTY_FORM,
          originalSlug: '',
          originalTitle: '',
        });
        return;
      }

      setBusy(true);
      try {
        const detail = await getArticle(row.id);
        if (!detail) {
          setError('Статья не найдена — возможно, её уже удалили. Список обновлён.');
          await load(status, appliedSearch);
          return;
        }
        setEditor({ id: detail.id, form: formFromDetail(detail), originalSlug: detail.slug, originalTitle: detail.title });
      } catch (e) {
        if (e instanceof AdminForbiddenError) {
          setForbidden(true);
          return;
        }
        setError(e instanceof Error ? e.message : 'Не удалось открыть статью.');
      } finally {
        setBusy(false);
      }
    },
    [appliedSearch, load, status]
  );

  const save = useCallback(async () => {
    if (!editor) return;
    const input = articleFormInput(editor.form);
    if (!input.title) {
      setEditorError('Заголовок обязателен: по нему статья ищется и индексируется.');
      return;
    }

    setBusy(true);
    setEditorError(null);
    try {
      if (editor.id === null) {
        await createArticle(input);
        setEditor(null);
        setNotice(`Черновик «${input.title}» создан. Опубликуйте его, когда текст будет готов.`);
      } else {
        await updateArticle(editor.id, input);
        setEditor(null);
        setNotice('Изменения сохранены.');
      }
      await load(status, appliedSearch);
    } catch (e) {
      if (e instanceof AdminForbiddenError) {
        setForbidden(true);
        return;
      }
      setEditorError(e instanceof Error ? e.message : 'Не удалось сохранить статью.');
    } finally {
      setBusy(false);
    }
  }, [appliedSearch, editor, load, status]);

  const pendingCount = useMemo(
    () => (feed ? feed.items.filter((row) => normalizeArticleStatus(row.status) === 'draft').length : 0),
    [feed]
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Статьи"
        subtitle="Текст пишется в markdown: сервер собирает из него HTML. Читатель видит только опубликованные статьи."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void openEditor(null)} disabled={busy || editor !== null}>
              Новая статья
            </Button>
            <Button variant="secondary" href="/articles">
              Открыть раздел
            </Button>
          </div>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      {editor ? (
        <ArticleEditor
          editor={editor}
          sections={sections}
          busy={busy}
          error={editorError}
          onChange={(next) => setEditor((current) => (current ? { ...current, form: next } : current))}
          onCancel={() => {
            setEditor(null);
            setEditorError(null);
          }}
          onSave={() => void save()}
          onRestore={() => {
            const targetId = editor.id;
            if (targetId === null) return;
            // Форма могла быть изменена — восстановление действует на сервере,
            // поэтому несохранённые правки не исчезают, а остаются в форме.
            void run(() => restoreArticle(targetId), 'Статья восстановлена.');
          }}
        />
      ) : (
        <>
          {/* ─── Фильтры ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр по статусу">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.label}
                  type="button"
                  aria-pressed={status === filter.value}
                  onClick={() => setStatus(filter.value)}
                  className={`rounded-md px-3 py-1.5 text-body-sm transition ${
                    status === filter.value
                      ? 'bg-surface-soft font-medium text-ink'
                      : 'text-slate hover:bg-surface-soft'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(search.trim());
              }}
            >
              <div className="relative">
                <SearchIcon
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по заголовку"
                  aria-label="Поиск по заголовку"
                  className="input h-10 pl-9"
                />
              </div>
              <Button type="submit" variant="secondary" disabled={busy}>
                Найти
              </Button>
              {appliedSearch && (
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-caption"
                  onClick={() => {
                    setSearch('');
                    setAppliedSearch('');
                  }}
                >
                  Сбросить
                </button>
              )}
            </form>
          </div>

          {/* ─── Таблица ─────────────────────────────────────────────── */}
          {feed === null ? (
            <LoadingState label="Загружаем статьи" />
          ) : (
            <>
              {feed.items.length === 0 ? (
                <EmptyState
                  lexi="read"
                  title={appliedSearch || status ? 'Ничего не нашлось' : 'Статей пока нет'}
                  description={
                    appliedSearch || status
                      ? 'Снимите фильтр или измените запрос — другие статьи на месте.'
                      : 'Первая статья — это черновик: сохраните текст, вычитайте и опубликуйте отдельным шагом.'
                  }
                  action={
                    appliedSearch || status ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSearch('');
                          setAppliedSearch('');
                          setStatus(null);
                        }}
                      >
                        Сбросить фильтры
                      </Button>
                    ) : (
                      <Button onClick={() => void openEditor(null)}>Новая статья</Button>
                    )
                  }
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-hairline">
                  <table className="w-full text-body-sm">
                    <thead className="bg-surface-soft text-left text-caption text-slate">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Заголовок</th>
                        <th className="px-3 py-2 font-semibold">Статус</th>
                        <th className="px-3 py-2 font-semibold">Раздел</th>
                        <th className="px-3 py-2 font-semibold">Обновлено</th>
                        <th className="px-3 py-2 text-right font-semibold">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feed.items.map((row) => {
                        const articleStatus = normalizeArticleStatus(row.status);
                        const isPublished = articleStatus === 'published';
                        return (
                          <tr key={row.id} className="border-t border-hairline-soft">
                            <td className="px-3 py-2 align-top">
                              <div className="font-medium text-ink">{row.title}</div>
                              <div className="text-caption text-steel">/{row.slug}</div>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <Tag tone={articleStatusTone(row.status)}>{statusLabel(row.status)}</Tag>
                            </td>
                            <td className="px-3 py-2 align-top text-slate">{row.sectionName ?? '—'}</td>
                            <td className="px-3 py-2 align-top text-caption text-steel">
                              {row.updatedAt ? (
                                <time dateTime={row.updatedAt}>{formatArticleDate(row.updatedAt)}</time>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <div className="flex flex-wrap justify-end gap-1">
                                <button
                                  type="button"
                                  className="btn-ghost px-2 py-1 text-caption"
                                  disabled={busy}
                                  onClick={() => void openEditor(row)}
                                >
                                  Редактировать
                                </button>
                                {isPublished ? (
                                  <button
                                    type="button"
                                    className="btn-ghost px-2 py-1 text-caption"
                                    disabled={busy}
                                    title="Статья исчезнет из публичной ленты, текст сохранится"
                                    onClick={() =>
                                      void run(() => archiveArticle(row.id), 'Статья снята с публикации.')
                                    }
                                  >
                                    Снять
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn-ghost px-2 py-1 text-caption text-primary"
                                    disabled={busy}
                                    title="Статья появится в публичной ленте"
                                    onClick={() =>
                                      void run(() => publishArticle(row.id), 'Статья опубликована.')
                                    }
                                  >
                                    Опубликовать
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn-ghost px-2 py-1 text-caption text-semantic-error"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `Удалить статью «${row.title}»? Удаление мягкое — её можно восстановить.`,
                                      )
                                    ) {
                                      return;
                                    }
                                    void run(() => deleteArticle(row.id), 'Статья удалена.');
                                  }}
                                >
                                  Удалить
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-caption text-steel">
                Всего: {feed.total}
                {pendingCount > 0 && ` · черновиков на этой странице: ${pendingCount}`}
              </p>
            </>
          )}
        </>
      )}

      <p className="text-caption text-steel">
        Проверить глазами:{' '}
        <Link href="/articles" className="text-link underline">
          публичный раздел статей
        </Link>{' '}
        — он читает те же данные, что и пользователи.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────── форма

function formFromDetail(detail: AdminArticleDetail): ArticleFormState {
  return {
    title: detail.title,
    slug: detail.slug,
    summary: detail.summary ?? '',
    sectionId: detail.sectionId === null ? '' : String(detail.sectionId),
    bodyMarkdown: detail.bodyMarkdown,
  };
}

interface ArticleEditorProps {
  editor: EditorState;
  sections: ArticleSectionOption[];
  busy: boolean;
  error: string | null;
  onChange: (next: ArticleFormState) => void;
  onCancel: () => void;
  onSave: () => void;
  onRestore: () => void;
}

/**
 * Форма статьи.
 *
 * Slug не обязателен: пустое поле значит «пусть сервер сгенерирует из
 * заголовка». Подсказка под полем появляется только когда введённый slug
 * действительно сломается — молчаливая замена значения была бы хуже ошибки.
 */
function ArticleEditor({
  editor,
  sections,
  busy,
  error,
  onChange,
  onCancel,
  onSave,
  onRestore,
}: ArticleEditorProps) {
  const { form, id } = editor;
  const slugValue = form.slug.trim();
  const slugBroken = slugValue.length > 0 && !isValidArticleSlug(slugValue);
  const titleEmpty = form.title.trim().length === 0;
  const publicHref = !slugBroken && slugValue && id !== null ? articlePublicPath(slugValue) : '';

  return (
    <form
      className="card flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 text-ink">{id === null ? 'Новая статья' : 'Редактирование статьи'}</h2>
        {publicHref && (
          <Link href={publicHref} className="text-caption text-link underline" target="_blank" rel="noreferrer">
            Открыть на сайте
          </Link>
        )}
      </div>

      <ArticleAssistant form={form} busy={busy} onApply={(next) => onChange(next)} />

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-body-sm text-slate">
          Заголовок
          <input
            className="input"
            value={form.title}
            required
            onChange={(e) => onChange({ ...form, title: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-body-sm text-slate">
          Slug <span className="text-caption text-steel">(необязательно — сгенерируется)</span>
          <input
            className="input"
            value={form.slug}
            placeholder="present-perfect"
            aria-invalid={slugBroken || undefined}
            onChange={(e) => onChange({ ...form, slug: e.target.value })}
          />
          {slugBroken && (
            <span className="text-caption text-semantic-error">
              Только латиница в нижнем регистре, цифры и одиночные дефисы.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-body-sm text-slate sm:col-span-2">
          Анонс
          <textarea
            className="input py-2"
            rows={2}
            value={form.summary}
            placeholder="Одно-два предложения для карточки в ленте"
            onChange={(e) => onChange({ ...form, summary: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-body-sm text-slate">
          Раздел
          <select
            className="input"
            value={form.sectionId === null ? '' : String(form.sectionId)}
            onChange={(e) => onChange({ ...form, sectionId: e.target.value })}
          >
            <option value="">Без раздела</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </label>

      </div>

      <MarkdownField
        value={form.bodyMarkdown}
        onChange={(next) => onChange({ ...form, bodyMarkdown: next })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || titleEmpty || slugBroken}>
          {busy ? 'Сохраняем…' : id === null ? 'Создать черновик' : 'Сохранить'}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
        {/* Восстановление — здесь, а не в таблице: удалённая статья не попадает
            в обычный список, и попасть на неё можно только прямой ссылкой
            «Редактировать» из фильтра «Все». */}
        {id !== null && (
          <Button type="button" variant="secondary" disabled={busy} onClick={onRestore}>
            Восстановить
          </Button>
        )}
      </div>
    </form>
  );
}
