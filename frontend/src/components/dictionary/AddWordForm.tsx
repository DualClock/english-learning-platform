'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError, apiMutate, invalidateCache } from '@/app/lib/api-client';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import { SparklesIcon, SpinnerIcon } from '@/components/ui/icons';
import { translationSourceLabel, type DictionaryTranslation } from './types';

interface WordResponse {
  id: number;
  text: string;
  definitions?: unknown[];
}

const PARTS_OF_SPEECH = [
  { value: '', label: 'Не указывать' },
  { value: 'noun', label: 'Существительное (noun)' },
  { value: 'verb', label: 'Глагол (verb)' },
  { value: 'adjective', label: 'Прилагательное (adjective)' },
  { value: 'adverb', label: 'Наречие (adverb)' },
  { value: 'phrase', label: 'Фраза (phrase)' },
  { value: 'other', label: 'Другое' },
];

const PART_VALUES = new Set(PARTS_OF_SPEECH.map((item) => item.value));
const ENGLISH_RE = /^[a-zA-Z\s'-]+$/;

interface SuccessState {
  text: string;
  withoutTranslation: boolean;
}

export default function AddWordForm() {

  const [text, setText] = useState('');
  const [definition, setDefinition] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('');
  const [example, setExample] = useState('');
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationSource, setTranslationSource] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const validate = (): string => {
    const word = text.trim();
    if (!word) return 'Введите слово';
    if (word.length > 100) return 'Слово длиннее 100 символов';
    if (!ENGLISH_RE.test(word)) return 'Слово должно состоять из английских букв, пробелов, дефисов и апострофов';
    if (definition.trim().length > 500) return 'Перевод длиннее 500 символов';
    if (example.trim().length > 500) return 'Пример длиннее 500 символов';
    return '';
  };

  const translate = async () => {
    const word = text.trim();
    setError('');
    setSuccess(null);

    const wordError = validateWordOnly(word);
    if (wordError) {
      setError(wordError);
      return;
    }

    setTranslating(true);
    try {
      const result = await apiMutate<DictionaryTranslation>('/api/ai/translate', {
        body: {
          word,
          context: example.trim() || undefined,
          targetLanguage: 'ru',
        },
      });

      const translation = result?.translation?.trim();
      if (!translation) {
        setError('Перевод не нашёлся. Впишите его вручную — слово можно сохранить и без него.');
        return;
      }

      setDefinition(translation);
      setTranslationSource(result.source ?? '');
      if (!partOfSpeech && result.partOfSpeech) {
        const normalized = result.partOfSpeech.trim().toLowerCase();
        if (PART_VALUES.has(normalized) && normalized) {
          setPartOfSpeech(normalized);
        }
      }
      if (!example.trim() && result.examples?.[0]?.english) {
        setExample(result.examples[0].english);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Сервис перевода недоступен. Впишите перевод вручную или сохраните слово без него.',
      );
    } finally {
      setTranslating(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const normalizedDefinition = definition.trim();
    setSaving(true);
    try {
      const created = await apiMutate<WordResponse>('/api/dictionary', {
        method: 'POST',
        body: {
          text: text.trim(),
          definition: normalizedDefinition || null,
          partOfSpeech: partOfSpeech || null,
          example: example.trim() || null,
          source: 'manual',
        },
        invalidate: ['/api/dictionary'],
      });

      invalidateCache('/api/dictionary');
      setSuccess({
        text: created?.text ?? text.trim(),
        withoutTranslation: !normalizedDefinition && !(created?.definitions?.length),
      });
      setText('');
      setDefinition('');
      setPartOfSpeech('');
      setExample('');
      setTranslationSource('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('Это слово уже есть в словаре');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Не удалось добавить слово. Проверьте соединение.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div role="status" aria-live="polite">
        {success && (
          <div className="mb-6">
            <Notice tone="success">
              <span>
                «{success.text}» добавлено в словарь
                {success.withoutTranslation ? ' без перевода — его можно добавить позже.' : '.'}
              </span>
              <Link href="/dictionary" className="mt-1 block font-medium underline underline-offset-2">
                Открыть словарь
              </Link>
            </Notice>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <form onSubmit={submit} className="card space-y-5 p-5 sm:p-6">
        <div>
          <label htmlFor="word-text" className="mb-1.5 block text-body-sm font-medium text-ink">
            Слово или фраза <span className="text-semantic-error">*</span>
          </label>
          <input
            id="word-text"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="например, resilience"
            autoComplete="off"
            autoFocus
            maxLength={100}
            className="input"
            aria-required="true"
          />
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="word-definition" className="block text-body-sm font-medium text-ink">
              Перевод
            </label>
            <button
              type="button"
              onClick={translate}
              disabled={translating || saving || !text.trim()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-body-sm font-medium text-primary transition-colors duration-fast hover:bg-surface-accent disabled:cursor-not-allowed disabled:text-slate"
            >
              {translating ? <SpinnerIcon size={16} /> : <SparklesIcon size={16} />}
              {translating ? 'Переводим…' : definition.trim() ? 'Перевести заново' : 'Перевести'}
            </button>
          </div>
          <input
            id="word-definition"
            type="text"
            value={definition}
            onChange={(event) => {
              setDefinition(event.target.value);
              setTranslationSource('');
            }}
            placeholder="например, стойкость, упругость"
            maxLength={500}
            className="input"
            aria-describedby="word-definition-help"
          />
          <div id="word-definition-help" className="mt-1.5 space-y-1">
            <p className="text-caption text-slate">
              Можно оставить пустым: слово сохранится и будет ждать перевода. В повторения оно
              попадёт после того, как вы добавите перевод.
            </p>
            {translationSource && (
              <p className="text-caption text-slate">
                Перевод подставил {translationSourceLabel(translationSource)}. Проверьте его перед
                сохранением.
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="word-pos" className="mb-1.5 block text-body-sm font-medium text-ink">
            Часть речи
          </label>
          <select
            id="word-pos"
            value={partOfSpeech}
            onChange={(event) => setPartOfSpeech(event.target.value)}
            className="input"
          >
            {PARTS_OF_SPEECH.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="word-example" className="mb-1.5 block text-body-sm font-medium text-ink">
            Контекст или пример
          </label>
          <textarea
            id="word-example"
            value={example}
            onChange={(event) => setExample(event.target.value)}
            placeholder="She showed great resilience after the failure."
            maxLength={500}
            rows={2}
            className="input h-auto min-h-20 resize-none py-2.5 leading-relaxed"
            aria-describedby="word-example-help"
          />
          <p id="word-example-help" className="mt-1.5 text-caption text-slate">
            Необязательно. Предложение, в котором вы услышали или прочитали слово.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <Button type="submit" disabled={saving || translating} className="min-h-11">
            {saving ? <SpinnerIcon size={16} /> : null}
            {saving ? 'Сохраняем…' : 'Добавить слово'}
          </Button>
          <Button href="/dictionary" variant="secondary" className="min-h-11">
            Отмена
          </Button>
        </div>
      </form>
    </div>
  );
}

function validateWordOnly(word: string): string {
  if (!word) return 'Сначала введите слово';
  if (word.length > 100) return 'Слово длиннее 100 символов';
  if (!ENGLISH_RE.test(word)) return 'Слово должно состоять из английских букв, пробелов, дефисов и апострофов';
  return '';
}
