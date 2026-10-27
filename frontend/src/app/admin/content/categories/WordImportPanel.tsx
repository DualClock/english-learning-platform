'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import { CloseIcon, SpinnerIcon, UploadIcon } from '@/components/ui/icons';
import { AdminForbiddenError, importWords } from '../api';
import {
  MAX_IMPORT_BYTES,
  describeImportHttpError,
  formatImportSummary,
  hasImportErrors,
  readImportResponse,
  validateImportFile,
  type ImportIssue,
  type ImportResult,
} from '@/lib/word-import';


/**
 * Встроенная панель массового импорта слов в категорию.
 *
 * Почему панель, а не модалка: модалку легко закрыть случайно и потерять
 * список ошибок по строкам, а админ с ним и работает — открывает файл рядом
 * и ищет строку 47. Здесь результат остаётся на экране, пока не нажали
 * «Очистить».
 *
 * Порядок кнопок повторяет безопасный сценарий: «Проверить» (dryRun) первым,
 * «Импортировать» — вторым и доступна только после того, как файл прошёл
 * проверку на клиенте. Сухой прогон ничего не пишет, поэтому его можно жать
 * сколько угодно.
 *
 * Текст «ничего не записано» — только там, где это правда: при 409 (сервер
 * отверг целиком) и в подсказке про сухой прогон. При настоящем импорте с
 * ошибками часть слов уже могла записаться, и говорить иначе — врать.
 */
export default function WordImportPanel({
  categoryId,
  categoryName,
  onImported,
  onForbidden,
  onClose,
}: {
  categoryId: number;
  categoryName: string;
  /** Вызывается после успешного импорта (dryRun=false), чтобы обновить слова. */
  onImported: () => void;
  /** 401/403 посреди работы: экран целиком переключить на «нужны права». */
  onForbidden: () => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState<'dry' | 'real' | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [wasDryRun, setWasDryRun] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const check = validateImportFile(file);
  const busy = running !== null;

  // Смена категории сбрасывает всё: результат по одной категории рядом с
  // другой читается как результат этой.
  useEffect(() => {
    setFile(null);
    setResult(null);
    setError(null);
    setDone(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [categoryId]);

  // Результат появляется ниже кнопок — уводим к нему фокус, иначе админ
  // нажмёт «Проверить» и не заметит, что список ошибок уже под кнопками.
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  const reset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    setDone(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const submit = useCallback(
    async (dryRun: boolean) => {
      if (!file) return;
      // Вторая проверка на клике: валидатор мог пропустить файл без size,
      // а на сервер уходит то, что выбрано прямо сейчас.
      const checkNow = validateImportFile(file);
      if (!checkNow.ok) {
        setError(checkNow.message);
        return;
      }

      setRunning(dryRun ? 'dry' : 'real');
      setError(null);
      setResult(null);
      setDone(false);

      try {
        const response = await importWords(categoryId, file, dryRun);
        if (!response.ok) {
          setError(describeImportHttpError({ status: response.status, body: response.body }));
          return;
        }

        const parsed = readImportResponse(response.body);
        setResult(parsed);
        setWasDryRun(dryRun);

        if (!dryRun) {
          // Файл прочитан сервером — повторная отправка того же файла дала бы
          // дубликаты. Сбрасываем выбор, но оставляем результат на экране.
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          setDone(true);
          onImported();
        }
      } catch (e) {
        if (e instanceof AdminForbiddenError) {
          onForbidden();
          return;
        }
        setError(
          e instanceof Error && e.message
            ? e.message
            : 'Не удалось отправить файл. Проверьте соединение и попробуйте ещё раз.'
        );
      } finally {
        setRunning(null);
      }
    },
    [categoryId, file, onForbidden, onImported]
  );

  return (
    <section
      aria-labelledby="word-import-title"
      className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="word-import-title" className="flex items-center gap-2 text-h3 text-ink">
            <UploadIcon size={20} />
            Импорт слов
          </h3>
          <p className="mt-1 text-caption text-steel">
            В категорию «{categoryName}». Сначала «Проверить» — она ничего не пишет и покажет, что
            было бы добавлено.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть импорт"
          className="-mr-1 -mt-1 shrink-0 rounded p-1.5 text-slate transition-colors duration-fast ease-soft hover:bg-surface-soft hover:text-ink"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      {/* ─── Формат файла: подсказка до выбора, а не после ошибки ─────── */}
      <div className="rounded-md bg-surface-soft p-3 text-body-sm text-slate">
        <p className="font-medium text-charcoal">Формат CSV</p>
        <p className="mt-1">
          Первая строка — заголовки, дальше по строке на слово. Колонки:{' '}
          <code className="rounded bg-surface px-1">English</code>,{' '}
          <code className="rounded bg-surface px-1">Translation</code>,{' '}
          <code className="rounded bg-surface px-1">Transcription</code>,{' '}
          <code className="rounded bg-surface px-1">Example</code>. Последние две можно оставить
          пустыми.
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-surface px-2 py-1.5 text-caption text-charcoal">
          {['English,Translation,Transcription,Example',
            'listen,слушать,/ˈlɪsən/,"Listen carefully."',
            'whisper,шептать,,'].join('\n')}
        </pre>

        <p className="mt-3 font-medium text-charcoal">Формат JSON</p>
        <p className="mt-1">
          Массив объектов с полями <code className="rounded bg-surface px-1">english</code> и{' '}
          <code className="rounded bg-surface px-1">translation</code>;{' '}
          <code className="rounded bg-surface px-1">transcription</code> и{' '}
          <code className="rounded bg-surface px-1">example</code> необязательны.
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-surface px-2 py-1.5 text-caption text-charcoal">
          {[
            '[',
            '  { "english": "listen", "translation": "слушать" },',
            '  { "english": "whisper", "translation": "шептать", "example": "…" }',
            ']',
          ].join('\n')}
        </pre>
      </div>

      {/* ─── Выбор файла ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label htmlFor="word-import-file" className="text-body-sm font-medium text-charcoal">
          Файл .csv или .json
        </label>
        <input
          id="word-import-file"
          ref={fileInputRef}
          type="file"
          accept=".csv,.json"
          disabled={busy}
          aria-describedby="word-import-file-hint"
          aria-invalid={file !== null && !check.ok ? true : undefined}
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFile(picked);
            setResult(null);
            setError(null);
            setDone(false);
          }}
          className="text-body-sm text-slate file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-hairline file:bg-surface-soft file:px-3 file:py-1.5 file:text-body-sm file:text-ink"
        />
        <p id="word-import-file-hint" className="text-caption text-steel">
          До {Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} МБ. Служебные строки с заголовками
          считаются как обычно — их номера тоже попадут в список.
        </p>
        {file && !check.ok && <Notice tone="danger">{check.message}</Notice>}
      </div>

      {/* ─── Действия ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={!file || !check.ok || busy}
          onClick={() => void submit(true)}
        >
          {running === 'dry' ? (
            <span className="flex items-center gap-2">
              <SpinnerIcon className="animate-spin" size={16} />
              Проверяем…
            </span>
          ) : (
            'Проверить'
          )}
        </Button>
        <Button disabled={!file || !check.ok || busy} onClick={() => void submit(false)}>
          {running === 'real' ? (
            <span className="flex items-center gap-2">
              <SpinnerIcon className="animate-spin" size={16} />
              Импортируем…
            </span>
          ) : (
            'Импортировать'
          )}
        </Button>
        {(file || result || error || done) && !busy && (
          <button type="button" className="btn-ghost px-2 py-1 text-caption" onClick={reset}>
            Очистить
          </button>
        )}
      </div>

      {error && <Notice tone="danger">{error}</Notice>}

      {/* ─── Результат ────────────────────────────────────────────────── */}
      {result && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="flex flex-col gap-3 outline-none"
        >
          <div
            className={`rounded-md p-3 text-body-sm ${
              hasImportErrors(result) ? 'bg-surface-warning text-on-warning' : 'bg-surface-success text-on-success'
            }`}
          >
            <p className="font-medium">{formatImportSummary(result, { dryRun: wasDryRun })}</p>
            {wasDryRun && !done && (
              <p className="mt-1">
                Это проверка: в базе ничего не изменилось. Если цифры устраивают — нажмите
                «Импортировать».
              </p>
            )}
            {done && result.added > 0 && (
              <p className="mt-1">Список слов обновлён. Повторно этот файл отправлять не нужно.</p>
            )}
          </div>

          {result.truncated && (
            <p className="text-caption text-steel">
              Показаны первые {result.errors.length + result.warnings.length} записей из ответа.
              Исправьте эти — остальные всплывут при следующей проверке.
            </p>
          )}

          {result.errors.length > 0 && (
            <IssueList
              title="Ошибки"
              tone="danger"
              issues={result.errors}
              hint="Строки с такими номерами при импорте будут пропущены."
            />
          )}

          {result.warnings.length > 0 && (
            <IssueList
              title="Предупреждения"
              tone="info"
              issues={result.warnings}
              hint="Слова импортируются, но стоит посмотреть."
            />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Список проблем с номерами строк.
 *
 * Номер строки — отдельной колонкой фиксированной ширины: админ ищет глазами
 * по возрастанию («40, 47, 51»), и `line: message` одной строкой читается
 * хуже. Записи без номера (например, «файл пустой») показываются с прочерком.
 */
function IssueList({
  title,
  tone,
  issues,
  hint,
}: {
  title: string;
  tone: 'danger' | 'info';
  issues: ImportIssue[];
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h4
        className={`text-caption font-semibold uppercase tracking-wide ${
          tone === 'danger' ? 'text-semantic-error' : 'text-slate'
        }`}
      >
        {title} ({issues.length})
      </h4>
      <p className="text-caption text-steel">{hint}</p>
      <ul className="max-h-64 overflow-y-auto rounded-md border border-hairline text-body-sm">
        {issues.map((issue, index) => (
          // Ключ по позиции: одинаковые (line, message) — законный ответ
          // сервера, и ключ по содержимому на них бы схлопнулся.
          <li
            key={index}
            className="flex gap-3 border-b border-hairline-soft px-3 py-1.5 last:border-b-0"
          >
            <span className="w-14 shrink-0 text-right font-mono text-caption text-steel">
              {issue.line === null ? '—' : `стр. ${issue.line}`}
            </span>
            <span className="min-w-0 break-words text-charcoal">
              {issue.message || 'сервер не описал причину'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
