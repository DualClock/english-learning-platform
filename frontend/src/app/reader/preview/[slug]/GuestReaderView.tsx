'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { CloseIcon, PlusIcon, VolumeIcon } from '@/components/ui/icons';
import {
  GUEST_BANNER_TEXT,
  guestWordUrl,
  segmentChapterText,
  signupHrefForWord,
  wordCtaCopy,
} from '@/lib/guest-reader';

/*
 * Гостевой вид превью (R2): серверный page.tsx отдаёт каталог и метаданные,
 * главу читает отсюда по клику…
 *
 * ⚠ Глава читается на сервере (page.tsx + guest-reader.server.ts) и приходит
 * сюда готовыми блоками: гостю важно видеть текст без JS, а краулер — индексировать
 * первую главу. Здесь остаются только интерактив и клиентские состояния.
 *
 * Что принципиально:
 *  - текст размечен на кнопки-слова (segmentChapterText). Клик мышью, тап на
 *    телефоне и Enter с клавиатуры дают один и тот же вызов — гостю не нужно
 *    попасть пальцем в нужную букву, как в читалке с caretRangeFromPoint;
 *  - ReaderShell НЕ импортируется: он требует токен и тянет прогресс, карман и
 *    озвучку. Здесь только те же CSS-классы .reader-flow/.reader-paragraph,
 *    поэтому типографика совпадает, а инвентарь — нет;
 *  - слово не сохраняется. «Сохранить в словарь» — ссылка на /onboarding с
 *    next=reader&word=…, чтобы после регистрации человек вернулся туда же.
 */

export interface GuestBlock {
  id: string;
  type: string;
  sentences: { id: string; text: string }[];
  alt?: string | null;
  caption?: string | null;
}

export interface GuestChapterPayload {
  bookSlug: string;
  bookTitle: string;
  id: string;
  title: string;
  index: number;
  totalChapters: number;
  blocks: GuestBlock[];
}

export interface GuestLookupPayload {
  word: string;
  cefrLevel?: string | null;
  translationRu?: string | null;
  freqRank?: number | null;
}

interface Props {
  slug: string;
  chapter: GuestChapterPayload;
  /** Опции не передаются: глава пришла с сервера вместе с HTML. */
  isPreview: boolean;
}

interface WordPanelState {
  word: string;
  sentence: string;
  loading: boolean;
  failed: boolean;
  lookup: GuestLookupPayload | null;
}

const BLOCK_CLASS: Record<string, string> = {
  heading: 'reader-block reader-heading',
  quote: 'reader-block reader-quote',
  listItem: 'reader-block reader-list-item',
  verse: 'reader-block reader-verse',
  paragraph: 'reader-block reader-paragraph',
};

/** Подпись уровня для панели: A1/A2/B1…, а если уровня нет — ничего. */
function levelTag(level: string | null | undefined): string | null {
  const code = (level ?? '').trim().toUpperCase();
  return code.length > 0 ? code : null;
}

export default function GuestReaderView({ slug, chapter, isPreview }: Props) {
  const [panel, setPanel] = useState<WordPanelState | null>(null);
  const requestIdRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Esc закрывает панель: тап по скриму на телефоне и клавиша на десктопе —
  // один и тот же выход.
  useEffect(() => {
    if (!panel) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel]);

  const openWord = useCallback(
    async (word: string, sentence: string) => {
      const requestId = ++requestIdRef.current;
      setPanel({ word, sentence, loading: true, failed: false, lookup: null });

      try {
        const response = await fetch(guestWordUrl(slug, word), {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) throw new Error(`guest word ${response.status}`);

        const lookup = (await response.json()) as GuestLookupPayload;
        // Пока ответ шёл, человек мог тапнуть другое слово: поздний ответ не
        // должен перетирать свежий.
        if (requestId !== requestIdRef.current) return;

        setPanel({ word, sentence, loading: false, failed: false, lookup });
      } catch {
        if (requestId !== requestIdRef.current) return;
        setPanel({ word, sentence, loading: false, failed: true, lookup: null });
      }
    },
    [slug]
  );

  const retry = () => {
    if (!panel) return;
    void openWord(panel.word, panel.sentence);
  };

  const cta = wordCtaCopy({
    translation: panel?.lookup?.translationRu ?? null,
    loading: panel?.loading,
    failed: panel?.failed,
  });

  const translation = panel?.lookup?.translationRu ?? null;
  const hasTranslation = !panel?.loading && !panel?.failed && typeof translation === 'string' && translation.trim().length > 0;
  const level = levelTag(panel?.lookup?.cefrLevel);

  return (
    <div className="reader-stage min-h-screen bg-[var(--reader-desk)] text-[var(--reader-ink)]" data-reader-theme="sepia">
      <header className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.16em] text-[var(--reader-ink-soft)]">
            Глава 1 из {chapter.totalChapters}
          </p>
          <h1 className="mt-1 truncate font-heading text-h3 text-[var(--reader-ink)]">{chapter.bookTitle}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/library/${encodeURIComponent(slug)}`}
            className="text-body-sm text-[var(--reader-ink-soft)] underline decoration-[var(--reader-hairline)] underline-offset-4 transition-colors duration-fast hover:text-[var(--reader-ink)]"
          >
            О книге
          </Link>
          <Button href="/onboarding" className="px-4 py-2 text-body-sm" data-testid="guest-header-cta">
            Сохранить слова
          </Button>
        </div>
      </header>

      {isPreview ? (
        <p
          className="mx-auto mb-3 w-full max-w-3xl px-4 text-body-sm text-[var(--reader-ink-soft)] sm:px-6"
          data-testid="guest-banner"
        >
          {GUEST_BANNER_TEXT}
        </p>
      ) : null}

      <main className="mx-auto w-full max-w-3xl px-0 pb-24 sm:px-6">
        <article className="reader-sheet rounded-none sm:rounded-lg" data-testid="guest-chapter">
          <div className="px-5 py-6 sm:px-[8%] sm:py-10">
            <h2 className="reader-block reader-heading text-balance" data-testid="guest-chapter-title">
              {chapter.title}
            </h2>

            <div className="reader-flow h-auto" lang="en" data-testid="guest-text">
              {chapter.blocks.map((block) => {
                const className = BLOCK_CLASS[block.type] ?? BLOCK_CLASS.paragraph;

                if (block.type === 'separator') {
                  return <hr key={block.id} className="reader-block reader-separator" />;
                }

                if (block.type === 'image') {
                  // Текстовое превью без подписанных ссылок на файлы: гостю
                  // картинки не отдаём, но место в книге не теряем.
                  return block.caption ? (
                    <p key={block.id} className="reader-block reader-figcaption">
                      {block.caption}
                    </p>
                  ) : null;
                }

                return (
                  <p key={block.id} className={className}>
                    {block.sentences.map((sentence, sentenceIndex) => (
                      <span key={sentence.id}>
                        {segmentChapterText(sentence.text).map((segment, index) =>
                          segment.kind === 'word' ? (
                            <button
                              key={`${sentence.id}-${index}`}
                              type="button"
                              className="rounded-[3px] px-[1px] text-left transition-colors duration-fast hover:bg-[var(--reader-mark)] hover:text-[var(--reader-ink)] focus-visible:bg-[var(--reader-mark-strong)] focus-visible:outline-none"
                              data-testid="guest-word"
                              data-word={segment.token.lookup}
                              onClick={() => void openWord(segment.token.lookup, sentence.text)}
                            >
                              {segment.token.text}
                            </button>
                          ) : (
                            <span key={`${sentence.id}-${index}`}>{segment.text}</span>
                          )
                        )}
                        {sentenceIndex < block.sentences.length - 1 ? ' ' : null}
                      </span>
                    ))}
                  </p>
                );
              })}
            </div>
          </div>
        </article>

        <section className="mx-auto mt-6 w-full max-w-3xl px-4 sm:px-0" aria-labelledby="guest-continue">
          <h2 id="guest-continue" className="text-h3 text-[var(--reader-ink)]">
            Что дальше
          </h2>
          <p className="mt-2 max-w-measure text-body text-[var(--reader-ink-soft)]">
            Остальные главы, закладка места и словарь со словами из этой книги открываются после
            бесплатной регистрации.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button href="/onboarding" className="px-5 py-2.5 text-body" data-testid="guest-continue-cta">
              Читать дальше с аккаунтом
            </Button>
            <Link
              href="/library"
              className="text-body-sm text-[var(--reader-ink-soft)] underline decoration-[var(--reader-hairline)] underline-offset-4"
            >
              Другие книги
            </Link>
          </div>
        </section>
      </main>

      {panel ? (
        <>
          <button
            type="button"
            aria-label="Закрыть перевод"
            className="fixed inset-0 z-40 bg-scrim"
            onClick={() => setPanel(null)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Перевод слова ${panel.word}`}
            data-testid="guest-word-panel"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--reader-hairline)] bg-[var(--reader-paper)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-[var(--reader-ink)] shadow-modal sm:inset-x-3 sm:bottom-3 sm:rounded-2xl sm:border"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-reading text-[1.8rem] leading-tight" data-testid="guest-word-title">
                  {panel.word}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {level ? (
                    <span
                      className="rounded-full border border-[var(--reader-hairline)] px-2 py-0.5 text-caption font-semibold"
                      data-testid="guest-word-level"
                    >
                      {level}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
                      window.speechSynthesis.speak(new SpeechSynthesisUtterance(panel.word));
                    }}
                    aria-label={`Произнести ${panel.word}`}
                    className="rounded p-1 text-[var(--reader-ink-soft)] hover:text-[var(--reader-ink)]"
                  >
                    <VolumeIcon size={16} />
                  </button>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setPanel(null)}
                aria-label="Закрыть карточку слова"
                data-testid="guest-word-close"
                className="rounded p-1 text-[var(--reader-ink-soft)] hover:bg-[var(--reader-wash)] hover:text-[var(--reader-ink)]"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="mt-2 min-h-[2.5rem]" data-testid="guest-word-body">
              {panel.loading ? (
                <p className="text-body-sm text-[var(--reader-ink-soft)]" role="status">
                  {cta.body}
                </p>
              ) : hasTranslation ? (
                <p className="font-reading text-[1.35rem] font-medium leading-snug text-primary" data-testid="guest-word-translation">
                  {translation}
                </p>
              ) : (
                <p className="text-body-sm text-[var(--reader-ink-soft)]">{cta.body}</p>
              )}
            </div>

            {panel.sentence ? (
              <p className="mt-4 rounded-lg border border-[var(--reader-hairline)] bg-[var(--reader-wash)] p-3 font-reading text-body-sm leading-relaxed text-[var(--reader-ink-soft)]">
                {panel.sentence}
              </p>
            ) : null}

            <div className="mt-5 space-y-2">
              {/*
               * «Повторить» НЕ заменяет «Сохранить в словарь». Раньше при
               * ошибке перевода кнопка регистрации исчезала — то есть человек,
               * у которого не пришёл перевод, терял единственный путь вперёд.
               * Теперь обе кнопки на месте: ошибка не отменяет смысл страницы.
               */}
              {panel.failed && (
                <Button variant="secondary" onClick={retry} className="w-full" data-testid="guest-word-retry">
                  Повторить
                </Button>
              )}
              <Button
                href={signupHrefForWord(panel.word)}
                className="w-full"
                data-testid="guest-word-save"
              >
                <PlusIcon size={16} aria-hidden />
                {cta.action}
              </Button>
              <p className="text-caption leading-snug text-[var(--reader-ink-soft)]">
                Без аккаунта слово не сохраняется — оно не появится в словаре и на повторении.
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
