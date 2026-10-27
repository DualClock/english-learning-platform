'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import {
  ASSISTANT_LEVELS,
  articleDraftRequest,
  articleDraftToForm,
  assistantStatusLabel,
  isAssistantDisabled,
  normalizeAssistantError,
  normalizeAssistantStatus,
  replaceConfirmMessage,
  toArticleDraft,
  type AssistantStatus,
  type DraftTargetForm,
} from '@/lib/assistant';
import { getAssistantStatus, generateArticleDraft } from './assistant-api';

/*
 * Панель AI-ассистента над формой статьи.
 *
 * Три решения, которые видны в вёрстке:
 *
 *  1. Лимит. Ручка тратит дневной лимит на каждый вызов, поэтому остаток
 *     показан всегда, а на нуле и при `enabled=false` кнопка мертва — с
 *     объяснением, а не с молчаливым disabled.
 *  2. Замена текста. Генерация заполняет поля поверх формы, и если тело уже
 *     написано, админ подтверждает потерю. Пустое поле — спрашивать не о чем.
 *  3. Текст ошибки. 429 и 503 — разные советы («ждать завтра» / «ИИ выключен»),
 *     поэтому показываем фразу сервера из поля `error`, а не «что-то пошло не так».
 *
 * Черновик приходит в форму, но НЕ сохраняется: сохранение — отдельная кнопка.
 * Иначе один клик по ИИ публиковал бы текст, который никто не читал.
 */

interface ArticleAssistantProps {
  /** Текущая форма: нужна, чтобы не затереть анонс, раздел и slug. */
  form: DraftTargetForm;
  /** Применить черновик к форме. */
  onApply: (form: DraftTargetForm) => void;
  /** Идёт сохранение — генерацию в это время не запускаем. */
  busy?: boolean;
}

export default function ArticleAssistant({ form, onApply, busy = false }: ArticleAssistantProps) {
  const fieldId = useId();
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState<string>('B1');
  const [audience, setAudience] = useState('');
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const result = await getAssistantStatus();
    if (result.ok) {
      setStatus(normalizeAssistantStatus(result.data));
      setStatusError(null);
      return;
    }
    // Статус — подсказка, а не условие работы: кнопку не отнимаем, но честно
    // говорим, что остаток неизвестен.
    setStatusError(normalizeAssistantError(result).message);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const request = articleDraftRequest({ topic, level, audience });
  const disabled = generating || busy || request === null || (status !== null && isAssistantDisabled(status));

  const generate = useCallback(async () => {
    if (!request) {
      setError('Напишите тему: по ней ассистент соберёт черновик.');
      return;
    }

    const confirmText = replaceConfirmMessage(form.bodyMarkdown);
    if (confirmText && !window.confirm(confirmText)) return;

    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateArticleDraft(request);
      if (!result.ok) {
        setError(normalizeAssistantError(result).message);
        // 429 меняет остаток — перечитываем, чтобы подпись не врала.
        if (result.status === 429) void refreshStatus();
        return;
      }

      const draft = toArticleDraft(result.data);
      if (!draft) {
        setError('Ассистент вернул пустой черновик. Попробуйте переформулировать тему.');
        return;
      }

      onApply(articleDraftToForm(form, draft));
      setNotice('Черновик вставлен в форму. Прочитайте его и сохраните — сам он не сохраняется.');
      void refreshStatus();
    } catch (e) {
      setError(normalizeAssistantError(e).message);
    } finally {
      setGenerating(false);
    }
  }, [form, onApply, refreshStatus, request]);

  const caption = status
    ? assistantStatusLabel(status)
    : statusError
      ? `Не удалось узнать остаток лимита: ${statusError}`
      : 'Проверяем остаток вызовов…';

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-soft/60 p-3"
      aria-label="AI-ассистент статьи"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-ink">Ассистент</h3>
        <span className="text-caption text-steel" aria-live="polite">
          {caption}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className="flex flex-col gap-1 text-body-sm text-slate" htmlFor={`${fieldId}-topic`}>
          Тема
          <input
            id={`${fieldId}-topic`}
            className="input"
            value={topic}
            placeholder="Present Perfect для школьников"
            onChange={(e) => setTopic(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-body-sm text-slate" htmlFor={`${fieldId}-level`}>
          Уровень
          <select
            id={`${fieldId}-level`}
            className="input"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            {ASSISTANT_LEVELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label
          className="flex flex-col gap-1 text-body-sm text-slate sm:col-span-2"
          htmlFor={`${fieldId}-audience`}
        >
          Аудитория <span className="text-caption text-steel">(необязательно)</span>
          <input
            id={`${fieldId}-audience`}
            className="input"
            value={audience}
            placeholder="Взрослые, готовятся к IELTS"
            onChange={(e) => setAudience(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={disabled} onClick={() => void generate()}>
          {generating ? 'Генерирую…' : 'Сгенерировать черновик'}
        </Button>
        {status?.enabled === false && (
          <span className="text-caption text-semantic-error">
            Ассистент выключен на сервере.
          </span>
        )}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <p className="text-caption text-steel">
        Черновик только заполняет форму: публикация и сохранение — отдельными кнопками. Каждый вызов
        расходует дневной лимит.
      </p>
    </section>
  );
}
