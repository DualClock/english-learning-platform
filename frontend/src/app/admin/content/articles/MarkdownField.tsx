'use client';

import { useMemo, useState } from 'react';
import { renderMarkdownPreview } from '@/lib/markdown-preview';

/*
 * Тело статьи с переключателем «Редактор / Просмотр».
 *
 * Сервер присылает готовый безопасный HTML только для сохранённых статей, а в
 * форме лежит ещё не сохранённый текст — поэтому предпросмотр собирается на
 * клиенте из markdown.
 *
 * dangerouslySetInnerHTML здесь допустим ровно потому, что его аргумент —
 * `renderMarkdownPreview`: функция сначала экранирует ВЕСЬ вход и только потом
 * накладывает разметку, так что ни одного сырого `<` из ввода в строке не
 * остаётся. Покрыто тестами XSS в `markdown-preview.test.mjs`.
 */

interface MarkdownFieldProps {
  value: string;
  onChange: (next: string) => void;
}

type Mode = 'edit' | 'preview';

const PREVIEW_CLASS = 'theory-text';

export default function MarkdownField({ value, onChange }: MarkdownFieldProps) {
  const [mode, setMode] = useState<Mode>('edit');
  // Рендер на каждую букву не нужен: строка меняется только при смене режима
  // или текста, и memo держит предыдущий результат между этими событиями.
  const html = useMemo(() => renderMarkdownPreview(value), [value]);
  const empty = value.trim().length === 0;

  return (
    <div className="flex flex-col gap-1 text-body-sm text-slate">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Текст статьи (markdown)</span>
        <div className="flex gap-1" role="group" aria-label="Режим тела статьи">
          <button
            type="button"
            aria-pressed={mode === 'edit'}
            onClick={() => setMode('edit')}
            className={`rounded-md px-3 py-1 text-caption transition ${
              mode === 'edit' ? 'bg-surface-soft font-medium text-ink' : 'text-slate hover:bg-surface-soft'
            }`}
          >
            Редактор
          </button>
          <button
            type="button"
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
            className={`rounded-md px-3 py-1 text-caption transition ${
              mode === 'preview' ? 'bg-surface-soft font-medium text-ink' : 'text-slate hover:bg-surface-soft'
            }`}
          >
            Просмотр
          </button>
        </div>
      </div>

      {mode === 'edit' ? (
        <textarea
          className="input font-mono py-2 text-body-sm"
          rows={18}
          spellCheck={false}
          value={value}
          placeholder={'## Подзаголовок\n\nАбзац текста. **Важное** — жирным, `код` — в обратных кавычках.'}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="min-h-[18rem] rounded-md border border-hairline bg-surface p-3 text-body text-ink">
          {empty ? (
            <p className="text-body-sm text-steel">
              Текст пока пуст — предпросмотр появится, как только что-то напишете.
            </p>
          ) : (
            // Аргумент — только выход безопасной функции (см. комментарий выше).
            // theory-text — тот же набор стилей, что у опубликованной статьи.
            <div className={PREVIEW_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      )}

      <span className="text-caption text-steel">
        {mode === 'edit'
          ? 'Предпросмотр показывает, как текст будет размечен. Оформление в ленте может отличаться — истина на сервере.'
          : 'Это наш рендер по правилам статьи. Сохранённую статью можно открыть на сайте и сверить.'}
        {' '}Сохранение — черновик; публикация отдельной кнопкой в списке.
      </span>
    </div>
  );
}
