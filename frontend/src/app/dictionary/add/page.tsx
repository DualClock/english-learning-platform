'use client';

import AppLayout from '@/components/AppLayout';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'motion/react';
import { ApiError, apiMutate, invalidateCache } from '@/app/lib/api-client';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { AlertIcon, ArrowLeftIcon, CheckIcon, SpinnerIcon, UserIcon } from '@/components/ui/icons';
import { variants } from '@/lib/motion';

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
        <EmptyState
          icon={<UserIcon size={24} />}
          title="Нужен аккаунт"
          description="Чтобы добавлять слова в словарь, войдите — словарь привязан к профилю."
          action={
            <Button href="/login" variant="primary">
              Войти
            </Button>
          }
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl">
        <Button href="/dictionary" variant="ghost" className="mb-3">
          <ArrowLeftIcon size={16} />
          К словарю
        </Button>
        <PageHeader
          title="Добавить слово"
          subtitle="Слово сразу попадёт в словарь и в расписание повторений"
        />

        {/* Живая область смонтирована заранее: появляющийся вместе с текстом
            region экранные читатели обычно не объявляют. */}
        <div role="status" aria-live="polite">
          <AnimatePresence initial={false}>
            {success && (
              <motion.div
                variants={variants.enter}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-success px-4 py-3 text-body-sm text-on-success"
              >
                <span className="flex items-center gap-2">
                  <CheckIcon size={20} />
                  {success}
                </span>
                <Link href="/dictionary" className="font-medium text-primary hover:underline">
                  Открыть словарь
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-2 rounded-lg border border-semantic-error bg-surface-danger px-4 py-3 text-body-sm text-on-danger"
          >
            <AlertIcon size={20} />
            {error}
          </div>
        )}

        <form onSubmit={submit} className="card space-y-5 p-6">
          <div>
            <label htmlFor="word-text" className="mb-1.5 block text-body-sm font-medium text-ink">
              Слово или фраза <span className="text-semantic-error">*</span>
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
            <label htmlFor="word-definition" className="mb-1.5 block text-body-sm font-medium text-ink">
              Перевод <span className="text-semantic-error">*</span>
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
            <label htmlFor="word-pos" className="mb-1.5 block text-body-sm font-medium text-ink">
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
            <label htmlFor="word-example" className="mb-1.5 block text-body-sm font-medium text-ink">
              Пример употребления
            </label>
            <textarea
              id="word-example"
              value={example}
              onChange={(e) => setExample(e.target.value)}
              placeholder="She showed great resilience after the failure."
              maxLength={500}
              rows={2}
              className="input h-auto min-h-20 py-2.5 leading-relaxed resize-none"
            />
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="submit" disabled={saving}>
              {saving ? <SpinnerIcon size={16} /> : null}
              {saving ? 'Сохраняем…' : 'Добавить слово'}
            </Button>
            <Button href="/dictionary" variant="secondary">
              Отмена
            </Button>
          </div>
        </form>

        <p className="mt-6 max-w-measure text-caption text-slate">
          Слова из книг можно добавлять прямо в читалке — нажмите на незнакомое слово и «В словарь».
          Готовые подборки есть в{' '}
          <Link href="/dictionary?tab=lists" className="text-primary hover:underline">
            сборниках
          </Link>
          .
        </p>
      </div>
    </AppLayout>
  );
}
