'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Notice from '@/components/ui/Notice';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import { CloseIcon, FeedbackIcon } from '@/components/ui/icons';
import { API_URL } from '@/app/lib/api-url';
import { FEEDBACK_OPEN_EVENT } from './events';

type FeedbackType = 'idea' | 'problem';

const TYPES: { value: FeedbackType; label: string }[] = [
  { value: 'idea', label: 'Идея' },
  { value: 'problem', label: 'Проблема' },
];

const MIN_LENGTH = 10;
const MAX_LENGTH = 2000;

/**
 * Форма обратной связи беты. Живёт в корневом layout: кнопки в сайдбаре,
 * на лендинге и в auth-экранах открывают её через FEEDBACK_OPEN_EVENT.
 */
export default function FeedbackWidget() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('idea');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  const resetDraft = useCallback(() => {
    setType('idea');
    setMessage('');
    setContact('');
    setWebsite('');
    setError(null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (sent) {
      setSent(false);
      resetDraft();
    }
  }, [sent, resetDraft]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, []);

  // Сценарий модалки: блокируем скролл страницы, ставим фокус в поле
  // и возвращаем его на кнопку, которая форму открыла.
  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 60);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      lastFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (open && sent) {
      successCloseRef.current?.focus();
    }
  }, [open, sent]);

  const onDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href]'
        )
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [close]
  );

  const canSend = message.trim().length >= MIN_LENGTH && !sending;

  const submit = async () => {
    if (!canSend) return;

    setSending(true);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.accessToken) {
        headers.Authorization = `Bearer ${session.accessToken}`;
      }

      const response = await fetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type,
          message: message.trim(),
          contact: contact.trim() || null,
          pagePath: pathname || '/',
          website,
        }),
      });

      if (!response.ok) {
        let serverMessage = '';
        try {
          const data = (await response.json()) as { message?: string };
          serverMessage = data?.message ?? '';
        } catch {
          // Тело ошибки может быть не JSON — покажем общий текст
        }
        throw new Error(serverMessage || 'Не получилось отправить отзыв. Попробуйте ещё раз.');
      }

      setSent(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Не получилось отправить отзыв. Попробуйте ещё раз.'
      );
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-scrim p-4 animate-fade-in sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onKeyDown={onDialogKeyDown}
        className="card max-h-[88vh] w-full max-w-lg overflow-y-auto p-5 shadow-modal animate-pop-in outline-none sm:p-6"
      >
        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-accent text-on-accent">
            <FeedbackIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="feedback-title" className="text-h2 text-ink">
              Обратная связь
            </h2>
            <p className="mt-1 text-body-sm text-slate">
              Бета-версия: расскажите, что улучшить или что сломалось.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть форму отзыва"
            className="-mr-1 -mt-1 shrink-0 rounded p-1.5 text-slate transition-colors duration-fast ease-soft hover:bg-surface hover:text-ink"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {sent ? (
          <div role="status" className="py-4 text-center">
            <LexiMascot pose="wave" className="mx-auto mb-4 w-24" />
            <p className="text-h3 text-ink">Спасибо, отзыв отправлен</p>
            <p className="mx-auto mt-2 max-w-measure-sm text-body-sm text-slate">
              Я читаю каждое сообщение. Если оставили контакт — смогу ответить.
            </p>
            <button
              ref={successCloseRef}
              type="button"
              onClick={close}
              className="btn-primary mt-6 w-full"
            >
              Закрыть
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-body-sm font-medium text-charcoal">Тип отзыва</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Тип отзыва">
                {TYPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={type === option.value}
                    onClick={() => setType(option.value)}
                    className={`inline-flex items-center rounded-md border px-4 py-2 text-body-sm font-medium transition-colors duration-fast ease-soft ${
                      type === option.value
                        ? 'border-primary bg-primary text-on-primary'
                        : 'border-hairline text-slate hover:border-hairline-strong hover:bg-surface hover:text-ink'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="feedback-message" className="mb-1.5 block text-body-sm font-medium text-charcoal">
                Сообщение
              </label>
              <textarea
                id="feedback-message"
                ref={textareaRef}
                value={message}
                onChange={(event) => setMessage(event.target.value.slice(0, MAX_LENGTH))}
                rows={6}
                required
                aria-required="true"
                placeholder="Что случилось или что хочется улучшить?"
                className="input h-auto min-h-32 resize-y py-3"
              />
              <div className="mt-1 flex items-center justify-between gap-3 text-caption text-slate">
                <span>Минимум {MIN_LENGTH} символов</span>
                <span aria-hidden="true">
                  {message.length} / {MAX_LENGTH}
                </span>
              </div>
            </div>

            <Input
              label="Контакт для ответа"
              hint="Необязательно: email или @telegram"
              placeholder="you@example.com или @nickname"
              value={contact}
              maxLength={200}
              onChange={(event) => setContact(event.target.value)}
            />

            {/* Honeypot: скрыто от людей и скринридеров, ловит простых ботов */}
            <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor="feedback-website">Website</label>
              <input
                id="feedback-website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>

            <p className="flex items-center gap-2 text-caption text-slate">
              <FeedbackIcon size={16} className="shrink-0" />
              Страница <span className="font-medium text-charcoal">{pathname || '/'}</span> приложится
              автоматически.
            </p>

            {error && <Notice tone="danger">{error}</Notice>}

            <Button className="w-full" onClick={submit} disabled={!canSend}>
              {sending ? 'Отправляю…' : 'Отправить отзыв'}
            </Button>
            <p className="text-center text-caption text-slate">
              Если оставите контакт, смогу ответить лично.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
