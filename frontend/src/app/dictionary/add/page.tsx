'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { ApiError, apiMutate, invalidateCache } from '@/app/lib/api-client';

interface WordResponse {
  id: number;
  text: string;
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

const ENGLISH_RE = /^[a-zA-Z\s'-]+$/;

export default function AddWordPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [text, setText] = useState('');
  const [definition, setDefinition] = useState('');
  const [partOfSpeech, setPartOfSpeech] = useState('');
  const [example, setExample] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const validate = (): string => {
    const word = text.trim();
    if (!word) return 'Введите слово';
    if (word.length > 100) return 'Слово длиннее 100 символов';
    if (!ENGLISH_RE.test(word)) return 'Слово должно состоять из английских букв, пробелов, дефисов и апострофов';
    if (!definition.trim()) return 'Введите перевод';
    if (definition.trim().length > 500) return 'Перевод длиннее 500 символов';
    if (example.trim().length > 500) return 'Пример длиннее 500 символов';
    return '';
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const created = await apiMutate<WordResponse>('/api/dictionary', {
        token: session?.accessToken,
        method: 'POST',
        body: {
          text: text.trim(),
          definition: definition.trim(),
          partOfSpeech: partOfSpeech || null,
          example: example.trim() || null,
          source: 'manual',
        },
        invalidate: ['/api/dictionary'],
      });

      invalidateCache('/api/dictionary');
      setSuccess(`«${created?.text ?? text.trim()}» добавлено в словарь`);
      setText('');
      setDefinition('');
      setPartOfSpeech('');
      setExample('');
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

  if (status === 'unauthenticated') {
    return (
      <AppLayout>
        <div className="card p-8 text-center">
          <p className="text-[var(--color-slate)] mb-4">Чтобы добавлять слова, войдите в аккаунт.</p>
          <Link href="/login" className="btn-primary">
            Войти
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link href="/dictionary" className="text-sm text-[var(--color-slate)] hover:text-[var(--color-ink)]">
            ← К словарю
          </Link>
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mt-3 mb-1">Добавить слово</h1>
          <p className="text-[var(--color-slate)]">
            Слово сразу попадёт в словарь и в расписание повторений
          </p>
        </div>

        {success && (
          <div
            role="status"
            className="mb-6 p-4 rounded-lg bg-[rgba(34,197,94,0.10)] border border-[var(--color-primary)] text-[var(--color-ink)] flex items-center justify-between gap-4"
          >
            <span>{success}</span>
            <Link href="/dictionary" className="text-sm font-medium text-[var(--color-primary)] hover:underline shrink-0">
              Открыть словарь
            </Link>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)]"
          >
            {error}
          </div>
        )}

        <form onSubmit={submit} className="card p-6 space-y-5">
          <div>
            <label htmlFor="word-text" className="block text-sm font-medium text-[var(--color-ink)] mb-1.5">
              Слово или фраза <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              id="word-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="например, resilience"
              autoComplete="off"
              autoFocus
              maxLength={100}
              className="input"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="word-definition" className="block text-sm font-medium text-[var(--color-ink)] mb-1.5">
              Перевод <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              id="word-definition"
              type="text"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="например, стойкость, упругость"
              maxLength={500}
              className="input"
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="word-pos" className="block text-sm font-medium text-[var(--color-ink)] mb-1.5">
              Часть речи
            </label>
            <select
              id="word-pos"
              value={partOfSpeech}
              onChange={(e) => setPartOfSpeech(e.target.value)}
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
            <label htmlFor="word-example" className="block text-sm font-medium text-[var(--color-ink)] mb-1.5">
              Пример употребления
            </label>
            <textarea
              id="word-example"
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="She showed great resilience after the failure."
              maxLength={500}
              rows={2}
              className="input resize-none"
            />
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Сохраняем…' : 'Добавить слово'}
            </button>
            <Link href="/dictionary" className="btn-secondary">
              Отмена
            </Link>
          </div>
        </form>

        <p className="text-sm text-[var(--color-slate)] mt-6">
          Слова из книг можно добавлять прямо в читалке — нажмите на незнакомое слово и «В словарь».
          Готовые подборки есть в{' '}
          <button type="button" onClick={() => router.push('/dictionary?tab=lists')} className="text-[var(--color-primary)] hover:underline">
            сборниках
          </button>
          .
        </p>
      </div>
    </AppLayout>
  );
}
