'use client';

import { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ApiError, apiMutate, invalidateCache } from '@/app/lib/api-client';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import ProgressBar from '@/components/ui/ProgressBar';
import { AlertIcon, CheckIcon, SpinnerIcon } from '@/components/ui/icons';
import { BULK_WORD_LIMIT, parseBulkWords } from '@/lib/bulkWords';
import { plural, pluralWords } from '@/lib/plural';
import type { DictionaryTranslation } from './types';

type RowStatus = 'pending' | 'translating' | 'adding' | 'added' | 'duplicate' | 'error';

interface BulkRow {
  key: string;
  text: string;
  status: RowStatus;
  translation?: string;
  error?: string;
  translationFailed?: boolean;
}

interface BulkAddFormProps {
  onRunningChange?: (running: boolean) => void;
}

const TERMINAL: RowStatus[] = ['added', 'duplicate', 'error'];

export default function BulkAddForm({ onRunningChange }: BulkAddFormProps) {
  const { data: session } = useSession();

  const [text, setText] = useState('');
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [rows, setRows] = useState<BulkRow[]>([]);

  const preview = useMemo(() => parseBulkWords(text), [text]);
  const running = phase === 'running';

  const doneCount = rows.filter((row) => TERMINAL.includes(row.status)).length;
  const addedCount = rows.filter((row) => row.status === 'added').length;
  const duplicateCount = rows.filter((row) => row.status === 'duplicate').length;
  const errorCount = rows.filter((row) => row.status === 'error').length;
  const failedTexts = rows.filter((row) => row.status === 'error').map((row) => row.text);

  const updateRow = (key: string, patch: Partial<BulkRow>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const changeText = (value: string) => {
    setText(value);
    if (phase !== 'idle') {
      setPhase('idle');
      setRows([]);
    }
  };

  const start = async () => {
    if (running || preview.exceedsLimit || preview.valid.length === 0) return;

    const token = session?.accessToken;
    const items: BulkRow[] = preview.valid.map((word, index) => ({
      key: `${index}-${word.toLocaleLowerCase('en')}`,
      text: word,
      status: 'pending',
    }));

    setRows(items);
    setPhase('running');
    onRunningChange?.(true);

    let cursor = 0;

    const addOne = async (row: BulkRow) => {
      let definition = '';
      let translationFailed = false;

      if (autoTranslate) {
        updateRow(row.key, { status: 'translating' });
        try {
          const translated = await apiMutate<DictionaryTranslation>('/api/ai/translate', {
            token,
            body: { word: row.text, targetLanguage: 'ru' },
          });
          definition = translated?.translation?.trim() ?? '';
          if (!definition) translationFailed = true;
        } catch {
          translationFailed = true;
        }
      }

      updateRow(row.key, {
        status: 'adding',
        translation: definition || undefined,
        translationFailed,
      });

      try {
        await apiMutate('/api/dictionary', {
          token,
          method: 'POST',
          body: {
            text: row.text,
            definition: definition || null,
            source: 'bulk',
          },
        });
        updateRow(row.key, {
          status: 'added',
          translation: definition || undefined,
          translationFailed,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          updateRow(row.key, { status: 'duplicate', error: 'уже есть в словаре' });
        } else {
          updateRow(row.key, {
            status: 'error',
            error: err instanceof ApiError ? err.message : 'не удалось сохранить',
          });
        }
      }
    };

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        await addOne(items[index]);
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(3, items.length) }, () => worker()),
      );
    } finally {
      invalidateCache('/api/dictionary');
      setPhase('done');
      onRunningChange?.(false);
    }
  };

  const reset = () => {
    setText('');
    setRows([]);
    setPhase('idle');
    setAutoTranslate(false);
  };

  const retryErrors = () => {
    setText(failedTexts.join('\n'));
    setRows([]);
    setPhase('idle');
  };

  return (
    <div>
      <form
        className="card space-y-5 p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="bulk-words" className="block text-body-sm font-medium text-ink">
              Слова через запятую или с новой строки
            </label>
            <span className="text-caption text-slate">
              до {BULK_WORD_LIMIT} {pluralWords(BULK_WORD_LIMIT)}
            </span>
          </div>
          <textarea
            id="bulk-words"
            value={text}
            onChange={(event) => changeText(event.target.value)}
            disabled={running}
            rows={7}
            maxLength={8000}
            placeholder={'listen, whisper, silence\nanswer\nresilience'}
            className="input h-auto min-h-40 resize-y py-3 font-reading text-body leading-relaxed"
            aria-describedby="bulk-words-help"
          />
          <p id="bulk-words-help" className="mt-1.5 text-caption text-slate">
            Повторы внутри списка уберём. Не-английские токены и пустые строки покажем до
            сохранения.
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-hairline p-3">
          <input
            type="checkbox"
            checked={autoTranslate}
            onChange={(event) => setAutoTranslate(event.target.checked)}
            disabled={running}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            <span className="block text-body-sm font-medium text-ink">Перевести AI перед добавлением</span>
            <span className="mt-0.5 block text-caption text-slate">
              Необязательно. Если перевод не получится, слово всё равно сохранится — без перевода.
            </span>
          </span>
        </label>

        {preview.exceedsLimit && (
          <Notice tone="danger">
            В списке {preview.valid.length} {pluralWords(preview.valid.length)}, а за один раз можно
            добавить не больше {BULK_WORD_LIMIT}. Уберите лишние слова.
          </Notice>
        )}

        {(text.trim() || rows.length > 0) && (
          <div className="rounded-lg border border-hairline bg-surface-sunken p-3 sm:p-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-slate">
              <span className="font-medium text-ink">
                {phase === 'idle'
                  ? `${preview.valid.length} ${pluralWords(preview.valid.length)} к добавлению`
                  : `Готово ${doneCount} из ${rows.length}`}
              </span>
              {preview.duplicates.length > 0 && (
                <span>
                  {preview.duplicates.length}{' '}
                  {plural(preview.duplicates.length, ['повтор', 'повтора', 'повторов'])} в списке
                </span>
              )}
              {preview.invalid.length > 0 && (
                <span>
                  {preview.invalid.length}{' '}
                  {plural(preview.invalid.length, ['не добавится', 'не добавятся', 'не добавятся'])}
                </span>
              )}
              {preview.emptyCount > 0 && (
                <span>
                  {preview.emptyCount}{' '}
                  {plural(preview.emptyCount, ['пустой пропуск', 'пустых пропуска', 'пустых пропусков'])}
                </span>
              )}
            </div>

            {(phase === 'running' || phase === 'done') && (
              <div className="mt-3">
                <ProgressBar
                  value={rows.length ? (doneCount / rows.length) * 100 : 0}
                  label={`Добавление слов: ${doneCount} из ${rows.length}`}
                />
              </div>
            )}

            {preview.invalid.length > 0 && (
              <div className="mt-3 rounded-md bg-surface-danger px-3 py-2 text-caption text-on-danger">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertIcon size={16} />
                  {plural(preview.invalid.length, ['Не добавится', 'Не добавятся', 'Не добавятся'])}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {preview.invalid.map((item) => (
                    <li key={`${item.value}-${item.reason}`} className="break-words">
                      <span className="font-medium">«{item.value}»</span> — {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.duplicates.length > 0 && (
              <p className="mt-2 break-words text-caption text-slate">
                Повторно в списке: {preview.duplicates.map((word) => `«${word}»`).join(', ')}
              </p>
            )}

            <ul aria-live="polite" aria-busy={running} className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {(phase === 'idle' ? preview.valid.map((word, index) => ({
                key: `${index}-${word.toLocaleLowerCase('en')}`,
                text: word,
                status: 'pending' as RowStatus,
              })) : rows).map((row) => (
                <li key={row.key} className="flex items-start justify-between gap-3 text-body-sm">
                  <span className="min-w-0 break-words text-ink">{row.text}</span>
                  <RowState row={row} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === 'done' && (
          <div role="status" aria-live="polite">
            <Notice tone={errorCount > 0 ? 'info' : 'success'}>
              <span className="font-medium">
                Добавлено {addedCount} {pluralWords(addedCount)}
                {duplicateCount > 0
                  ? `, ${duplicateCount} ${plural(duplicateCount, [
                      'уже было в словаре',
                      'уже были в словаре',
                      'уже были в словаре',
                    ])}`
                  : ''}
                {errorCount > 0 ? `, ${errorCount} не удалось` : ''}.
              </span>
              <span className="block text-caption">
                {addedCount > 0
                  ? 'Если перевод не подставился, его можно добавить в словаре.'
                  : 'Список не изменился. Ошибки видны напротив слов.'}
              </span>
            </Notice>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {phase === 'idle' && (
            <Button
              type="submit"
              disabled={preview.valid.length === 0 || preview.exceedsLimit || running}
              className="min-h-11"
            >
              {running ? <SpinnerIcon size={16} /> : null}
              {preview.valid.length > 0
                ? `Добавить ${preview.valid.length} ${pluralWords(preview.valid.length)}`
                : 'Добавить слова'}
            </Button>
          )}

          {phase === 'running' && (
            <Button type="button" disabled className="min-h-11">
              <SpinnerIcon size={16} />
              Добавляем… {doneCount}/{rows.length}
            </Button>
          )}

          {phase === 'done' && (
            <>
              <Button type="button" variant="secondary" onClick={reset} className="min-h-11">
                Добавить ещё список
              </Button>
              {errorCount > 0 && (
                <Button type="button" variant="secondary" onClick={retryErrors} className="min-h-11">
                  Повторить ошибки ({errorCount})
                </Button>
              )}
              <Button href="/dictionary" variant="ghost" className="min-h-11">
                Открыть словарь
              </Button>
            </>
          )}

          {phase === 'idle' && (
            <Button href="/dictionary" variant="secondary" className="min-h-11">
              Отмена
            </Button>
          )}
        </div>
      </form>

      <p className="mt-5 max-w-measure text-caption text-slate">
        Можно смешивать форматы: например, вставить абзац с запятыми, а ниже — ещё несколько слов
        каждое с новой строки. Список разберётся по порядку.
      </p>
    </div>
  );
}

function RowState({ row }: { row: BulkRow }) {
  if (row.status === 'added') {
    return (
      <span className="flex max-w-[60%] shrink-0 items-start justify-end gap-1 text-right text-caption text-semantic-success">
        <CheckIcon size={16} className="mt-0.5 shrink-0" />
        {row.translation ? `добавлено · ${row.translation}` : 'добавлено без перевода'}
      </span>
    );
  }

  if (row.status === 'duplicate') {
    return <span className="shrink-0 text-caption text-slate">уже в словаре</span>;
  }

  if (row.status === 'error') {
    return (
      <span className="max-w-[55%] shrink-0 text-right text-caption text-semantic-error">
        {row.error ?? 'ошибка'}
      </span>
    );
  }

  if (row.status === 'translating') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-caption text-slate">
        <SpinnerIcon size={16} />
        переводим
      </span>
    );
  }

  if (row.status === 'adding') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-caption text-slate">
        <SpinnerIcon size={16} />
        сохраняем
      </span>
    );
  }

  return <span className="shrink-0 text-caption text-slate">готово к добавлению</span>;
}
