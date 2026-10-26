/*
 * Серверное чтение первой главы для /reader/preview/<slug>.
 *
 * ТОЛЬКО для серверных компонентов: берёт текст у бэкенда по абсолютному
 * адресу (браузерной куки здесь нет, и прокси /api/next не нужен — гостевая
 * выдача анонимна). Модуль не бросает никогда: недоступный бэкенд — это
 * состояние страницы («текст не загрузился»), а не 500 у краулера и не белый
 * экран у человека, пришедшего из поста в мессенджере.
 *
 * Отдельный файл, а не правка library-catalog.ts: тот отвечает за каталог
 * витрины и принадлежит другой задаче; здесь другой контракт (глава, а не
 * карточка) и другой предел ожидания.
 */

import type { GuestBlock, GuestChapterPayload } from '@/app/reader/preview/[slug]/GuestReaderView';

/** Совпадает с src/app/lib/api-url.ts; продублировано, как в library-catalog.ts. */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5226';

/**
 * Ждать бэкенд дольше, чем каталог (4 с), но не бесконечно: первая распаковка
 * EPUB на холодном кэше бэкенда занимает секунды, а висящий SSR не отдаёт
 * ничего. Таймаут — предсказуемый переход на «текст не загрузился».
 */
const CHAPTER_TIMEOUT_MS = 6000;

/** Глава книги меняется только вместе с книгой. */
const CHAPTER_REVALIDATE_SECONDS = 3600;

export type GuestChapterLoad =
  | { status: 'ok'; chapter: GuestChapterPayload }
  | { status: 'empty' }
  | { status: 'error' };

function chapterApiUrl(slug: string, chapterId: string): string {
  const base = API_BASE.replace(/\/+$/, '');
  return `${base}/api/guest/books/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(chapterId)}`;
}

/**
 * Первую главу нельзя спросить «без id»: маршрут обещает {chapterId}, и пустой
 * сегмент дал бы другой адрес. Поэтому сначала манифест (он сам отдаёт id
 * единственной доступной главы), потом глава. Два запроса, оба кэшируемые.
 */
export async function loadGuestChapter(slug: string): Promise<GuestChapterLoad> {
  const wanted = slug?.trim();
  if (!wanted) return { status: 'empty' };

  const manifest = await getJson<{ hasText?: boolean; chapters?: { id?: string }[] }>(
    `${API_BASE.replace(/\/+$/, '')}/api/guest/books/${encodeURIComponent(wanted)}`
  );

  if (manifest.status === 'error') return { status: 'error' };
  if (manifest.status === 'missing') return { status: 'empty' };

  const chapterId = manifest.data?.chapters?.[0]?.id;
  if (!manifest.data?.hasText || !chapterId) return { status: 'empty' };

  const chapter = await getJson<GuestChapterPayload>(chapterApiUrl(wanted, chapterId));
  if (chapter.status === 'error') return { status: 'error' };
  if (chapter.status === 'missing') return { status: 'empty' };
  if (!chapter.data || !Array.isArray(chapter.data.blocks)) return { status: 'empty' };

  // Защитный разбор: страница не имеет права упасть из-за чужого JSON.
  // Блок без предложений и без подписи в гостевом тексте нечего показывать.
  const blocks: GuestBlock[] = chapter.data.blocks
    .filter((block): block is GuestBlock => Boolean(block && typeof block.id === 'string'))
    .map((block) => ({
      id: block.id,
      type: typeof block.type === 'string' ? block.type : 'paragraph',
      sentences: Array.isArray(block.sentences)
        ? block.sentences
            .filter((sentence) => sentence && typeof sentence.id === 'string' && typeof sentence.text === 'string')
            .map((sentence) => ({ id: sentence.id, text: sentence.text }))
        : [],
      alt: typeof block.alt === 'string' ? block.alt : null,
      caption: typeof block.caption === 'string' ? block.caption : null,
    }));

  return {
    status: 'ok',
    chapter: {
      bookSlug: wanted,
      bookTitle: typeof chapter.data.bookTitle === 'string' ? chapter.data.bookTitle : '',
      id: typeof chapter.data.id === 'string' ? chapter.data.id : chapterId,
      title: typeof chapter.data.title === 'string' ? chapter.data.title : 'Глава 1',
      index: 0,
      totalChapters:
        typeof chapter.data.totalChapters === 'number' && chapter.data.totalChapters > 0
          ? chapter.data.totalChapters
          : 1,
      blocks,
    },
  };
}

type JsonOutcome<T> =
  | { status: 'ok'; data: T | null }
  | { status: 'missing' }
  | { status: 'error' };

async function getJson<T>(url: string): Promise<JsonOutcome<T>> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(CHAPTER_TIMEOUT_MS),
      next: { revalidate: CHAPTER_REVALIDATE_SECONDS },
      headers: { Accept: 'application/json' },
    });

    if (response.status === 404 || response.status === 403) return { status: 'missing' };
    if (!response.ok) return { status: 'error' };

    return { status: 'ok', data: (await response.json()) as T };
  } catch (error) {
    console.warn(
      '[reader/preview] бэкенд чтения недоступен:',
      error instanceof Error ? error.message : error
    );
    return { status: 'error' };
  }
}
