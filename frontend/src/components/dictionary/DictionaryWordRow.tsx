'use client';

import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ApiError, apiMutate, invalidateCache } from '@/app/lib/api-client';
import Button from '@/components/ui/Button';
import { Tag } from '@/components/ui/Badge';
import {
  CloseIcon,
  PlusIcon,
  SpinnerIcon,
  SparklesIcon,
  TrashIcon,
  VolumeIcon,
} from '@/components/ui/icons';
import { useTts } from '@/hooks/useTts';
import { transition } from '@/lib/motion';
import { WORD_EMOJIS } from '@/lib/wordVisuals';
import WordVisual from './WordVisual';
import {
  sourceLabel,
  type DictionaryTranslation,
  type DictionaryWord,
} from './types';

interface DictionaryWordRowProps {
  word: DictionaryWord;
  token?: string | null;
  onDelete: (id: number) => void;
  onUpdated: () => void;
}

type BusyAction = 'ai' | 'manual' | null;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 1024 * 1024;

export default function DictionaryWordRow({
  word,
  onDelete,
  onUpdated,
}: DictionaryWordRowProps) {
  const { speak, isLoading: isSpeakingLoading } = useTts();
  const [busy, setBusy] = useState<BusyAction>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const [visualOpen, setVisualOpen] = useState(false);
  const [visualBusy, setVisualBusy] = useState(false);
  const [visualError, setVisualError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const definition = word.definitions[0];
  const context =
    word.context && word.context !== definition?.example ? word.context : '';
  const source = sourceLabel(word.source);
  const hasVisual = Boolean(word.emoji || word.imageUrl);

  const translate = async () => {
    setError('');
    setAnnouncement('');
    setBusy('ai');

    try {
      const result = await apiMutate<DictionaryTranslation>('/api/ai/translate', {
        body: { word: word.text, context: context || undefined, targetLanguage: 'ru' },
      });
      const translation = result?.translation?.trim();

      if (!translation) {
        setError('Перевод не нашёлся. Впишите его вручную.');
        return;
      }

      await apiMutate(`/api/dictionary/${word.id}`, {
        method: 'PUT',
        body: { definition: translation },
        invalidate: ['/api/dictionary'],
      });

      setAnnouncement(`Перевод для «${word.text}» сохранён`);
      onUpdated();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Не удалось перевести и сохранить. Попробуйте вписать перевод вручную.',
      );
    } finally {
      setBusy(null);
    }
  };

  const saveManual = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) {
      setError('Введите перевод');
      return;
    }

    setError('');
    setAnnouncement('');
    setBusy('manual');

    try {
      await apiMutate(`/api/dictionary/${word.id}`, {
        method: 'PUT',
        body: { definition: value },
        invalidate: ['/api/dictionary'],
      });
      setAnnouncement(`Перевод для «${word.text}» сохранён`);
      setEditing(false);
      setDraft('');
      onUpdated();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Не удалось сохранить перевод. Проверьте соединение.',
      );
    } finally {
      setBusy(null);
    }
  };

  const saveEmoji = async (emoji: string) => {
    setVisualError('');
    setVisualBusy(true);

    try {
      await apiMutate(`/api/dictionary/${word.id}/emoji`, {
        method: 'PUT',
        body: { emoji },
        invalidate: ['/api/dictionary'],
      });
      setAnnouncement(`Визуал для «${word.text}» сохранён`);
      setVisualOpen(false);
      onUpdated();
    } catch (err) {
      setVisualError(
        err instanceof ApiError ? err.message : 'Не удалось сохранить эмодзи.',
      );
    } finally {
      setVisualBusy(false);
    }
  };

  const uploadImage = async (file: File) => {
    setVisualError('');

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setVisualError('Поддерживаются только JPG, PNG и WEBP');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setVisualError('Файл слишком большой. Максимум 1 МБ');
      return;
    }

    setVisualBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/next/dictionary/${word.id}/image`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Не удалось загрузить картинку (${res.status})`);
      }

      invalidateCache('/api/dictionary');
      setAnnouncement(`Картинка для «${word.text}» сохранена`);
      setVisualOpen(false);
      onUpdated();
    } catch (err) {
      setVisualError(
        err instanceof Error ? err.message : 'Не удалось загрузить картинку.',
      );
    } finally {
      setVisualBusy(false);
    }
  };

  const clearVisual = async () => {
    setVisualError('');
    setVisualBusy(true);

    try {
      await apiMutate(`/api/dictionary/${word.id}/visual`, {
        method: 'DELETE',
        invalidate: ['/api/dictionary'],
      });
      setAnnouncement(`Визуал для «${word.text}» убран`);
      setVisualOpen(false);
      onUpdated();
    } catch (err) {
      setVisualError(
        err instanceof ApiError ? err.message : 'Не удалось убрать визуал.',
      );
    } finally {
      setVisualBusy(false);
    }
  };

  return (
    <motion.li
      exit={{ opacity: 0, x: -12, transition: transition.fast }}
      className="card flex items-start justify-between gap-3 p-4 sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => {
              setVisualOpen((open) => !open);
              setVisualError('');
            }}
            aria-label={`${hasVisual ? 'Изменить' : 'Добавить'} визуал для «${word.text}»`}
            aria-expanded={visualOpen}
            aria-controls={`visual-${word.id}`}
            className="relative rounded-lg transition-transform duration-fast hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <WordVisual
              word={word.text}
              emoji={word.emoji}
              imageUrl={word.imageUrl}
              fallbackEmoji={word.categoryIcon}
            />
            {!hasVisual && (
              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-surface text-primary"
              >
                <PlusIcon size={16} />
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                onClick={() => speak(word.text)}
                className="min-h-11 break-words text-left text-body-lg font-semibold text-ink transition-colors duration-fast hover:text-primary"
              >
                {word.text}
              </button>
              <button
                type="button"
                onClick={() => speak(word.text)}
                className="icon-chip h-11 min-w-11 border-transparent bg-transparent hover:bg-surface"
                title={isSpeakingLoading ? 'Озвучиваем…' : 'Произнести'}
                aria-label={`Произнести ${word.text}`}
                aria-busy={isSpeakingLoading}
              >
                {isSpeakingLoading
                  ? <SpinnerIcon size={16} className="animate-spin" label="Озвучиваем" />
                  : <VolumeIcon size={16} />}
              </button>
              {definition?.partOfSpeech && <Tag tone="neutral">{definition.partOfSpeech}</Tag>}
              {source && <Tag tone="neutral">{source}</Tag>}
            </div>

            {definition ? (
              <>
                <p className="mt-1 text-body-sm text-slate">{definition.definition}</p>
                {definition.example && (
                  <p className="mt-1 text-body-sm italic text-slate">«{definition.example}»</p>
                )}
                {context && (
                  <p className="mt-1 line-clamp-2 text-caption text-slate" title={context}>
                    Контекст: «{context}»
                  </p>
                )}
              </>
            ) : (
              <div className="mt-1">
                <p className="text-body-sm text-slate">Перевод появится позже</p>

                {!editing && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-1">
                    <button
                      type="button"
                      onClick={translate}
                      disabled={busy !== null}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-body-sm font-medium text-primary transition-colors duration-fast hover:bg-surface-accent disabled:cursor-not-allowed disabled:text-slate"
                    >
                      {busy === 'ai' ? <SpinnerIcon size={16} /> : <SparklesIcon size={16} />}
                      {busy === 'ai' ? 'Переводим…' : 'Перевести'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setDraft('');
                        setError('');
                      }}
                      disabled={busy !== null}
                      aria-label={`Добавить перевод для «${word.text}» вручную`}
                      className="inline-flex min-h-11 items-center rounded-md px-2 text-body-sm font-medium text-slate transition-colors duration-fast hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:text-slate"
                    >
                      Вручную
                    </button>
                  </div>
                )}

                {editing && (
                  <form onSubmit={saveManual} className="mt-2 space-y-2">
                    <label htmlFor={`definition-${word.id}`} className="sr-only">
                      Перевод для слова {word.text}
                    </label>
                    <input
                      id={`definition-${word.id}`}
                      type="text"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      maxLength={500}
                      autoFocus
                      placeholder="например, слушать"
                      className="input"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={busy !== null} className="min-h-11">
                        {busy === 'manual' ? <SpinnerIcon size={16} /> : null}
                        {busy === 'manual' ? 'Сохраняем…' : 'Сохранить перевод'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => {
                          setEditing(false);
                          setDraft('');
                          setError('');
                        }}
                      >
                        Отмена
                      </Button>
                    </div>
                  </form>
                )}

                {context && (
                  <p className="mt-1 line-clamp-2 text-caption text-slate" title={context}>
                    Контекст: «{context}»
                  </p>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-2 text-caption text-semantic-error">
                {error}
              </p>
            )}
          </div>
        </div>

        {visualOpen && (
          <div
            id={`visual-${word.id}`}
            className="mt-3 rounded-lg border border-hairline bg-surface p-3"
            aria-busy={visualBusy}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-body-sm font-medium text-ink">Визуал слова</p>
                <p className="mt-0.5 text-caption text-slate">
                  Личный эмодзи или картинка — видно только вам.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVisualOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate transition-colors duration-fast hover:bg-surface-sunken hover:text-ink"
                aria-label="Закрыть выбор визуала"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            <div
              role="group"
              aria-label="Эмодзи для слова"
              className="mt-2 grid max-h-60 max-w-md grid-cols-5 gap-1 overflow-y-auto sm:grid-cols-8"
            >
              {WORD_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => saveEmoji(emoji)}
                  disabled={visualBusy}
                  aria-label={`Выбрать эмодзи ${emoji}`}
                  className={`flex h-11 items-center justify-center rounded-md border text-xl transition-colors duration-fast hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50 ${
                    word.emoji === emoji
                      ? 'border-primary bg-surface-accent'
                      : 'border-transparent'
                  }`}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadImage(file);
                  event.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={visualBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {visualBusy ? <SpinnerIcon size={16} /> : null}
                {visualBusy ? 'Сохраняем…' : 'Загрузить картинку'}
              </Button>
              <span className="text-caption text-slate">JPG, PNG или WEBP до 1 МБ</span>
              {hasVisual && (
                <button
                  type="button"
                  onClick={clearVisual}
                  disabled={visualBusy}
                  className="inline-flex min-h-11 items-center rounded-md px-2 text-body-sm font-medium text-slate transition-colors duration-fast hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:text-slate"
                >
                  Убрать визуал
                </button>
              )}
            </div>

            {visualError && (
              <p role="alert" className="mt-2 text-caption text-semantic-error">
                {visualError}
              </p>
            )}
          </div>
        )}

        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onDelete(word.id)}
        className="icon-chip h-11 w-11 shrink-0 border-transparent bg-transparent text-semantic-error hover:bg-surface-danger"
        title="Удалить слово"
        aria-label={`Удалить ${word.text}`}
      >
        <TrashIcon size={20} />
      </button>
    </motion.li>
  );
}
