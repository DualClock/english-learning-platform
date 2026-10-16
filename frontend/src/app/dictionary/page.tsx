'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import WordListsSection from '@/components/dictionary/WordListsSection';
import { useSpeech } from '@/hooks/useSpeech';

interface Word {
  id: number;
  text: string;
  language?: string;
  definitions: {
    id: number;
    definition: string;
    partOfSpeech?: string;
    example?: string;
  }[];
  createdAt: string;
}

function DictionaryTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'lists' ? 'lists' : 'my';

  const tabs = [
    { key: 'my', label: 'Мой словарь' },
    { key: 'lists', label: 'Сборники' }
  ];

  return (
    <div className="flex gap-6 border-b border-[var(--color-hairline-strong)] mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => router.push(tab.key === 'my' ? '/dictionary' : '/dictionary?tab=lists')}
          className={`pb-3 px-1 text-sm font-medium transition-colors relative ${
            activeTab === tab.key
              ? 'text-[var(--color-primary)]'
              : 'text-[var(--color-slate)] hover:text-[var(--color-ink)]'
          }`}
        >
          {tab.label}
          {activeTab === tab.key && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[var(--color-primary)]"></span>
          )}
        </button>
      ))}
    </div>
  );
}

function DictionaryContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') === 'lists' ? 'lists' : 'my';

  const [words, setWords] = useState<Word[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      loadWords();
    }
  }, [status, router]);

  const loadWords = async () => {
    try {
      const token = session?.accessToken;
      const res = await fetch('http://localhost:5226/api/dictionary', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to load words');

      const data = await res.json();
      setWords(data);
      setIsLoading(false);
    } catch {
      setError('Ошибка загрузки слов');
      setIsLoading(false);
    }
  };

  const searchWords = async () => {
    if (!searchQuery.trim()) {
      loadWords();
      return;
    }

    try {
      const token = session?.accessToken;
      const res = await fetch(`http://localhost:5226/api/dictionary/search?query=${searchQuery}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Search failed');

      const data = await res.json();
      setWords(data);
    } catch {
      setError('Ошибка поиска');
    }
  };

  const deleteWord = async (id: number) => {
    if (!confirm('Удалить это слово?')) return;

    try {
      const token = session?.accessToken;
      await fetch(`http://localhost:5226/api/dictionary/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      setWords(words.filter(w => w.id !== id));
    } catch {
      setError('Ошибка удаления');
    }
  };

  const { speak } = useSpeech();

  if (status === 'loading' || (isLoading && activeTab === 'my')) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  if (activeTab === 'lists') {
    return (
      <AppLayout>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Словарь</h1>
          <p className="text-[var(--color-slate)]">Готовые сборники слов по уровням и темам</p>
        </div>
        <Suspense fallback={null}>
          <DictionaryTabs />
        </Suspense>
        <WordListsSection />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--color-ink)] mb-2">Словарь</h1>
        <p className="text-[var(--color-slate)]">{words.length} слов сохранено</p>
      </div>

      <Suspense fallback={null}>
        <DictionaryTabs />
      </Suspense>

      {/* Поиск и добавление */}
      <div className="card p-6 mb-6">
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Поиск слов..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchWords()}
              className="input pl-10"
            />
            <svg className="absolute left-3 top-3.5 w-5 h-5 text-[var(--color-slate)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            onClick={searchWords}
            className="btn-secondary"
          >
            Найти
          </button>
          <a
            href="/dictionary/add"
            className="btn-primary"
          >
            + Добавить
          </a>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)]">
          {error}
        </div>
      )}

      {/* Список слов */}
      {words.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-[var(--color-slate)] mb-4">Словарь пуст</p>
          <a href="/dictionary/add" className="btn-primary">
            Добавить первое слово
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          {words.map((word) => (
            <div key={word.id} className="card p-4 flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => speak(word.text)}
                    className="text-xl font-bold text-[var(--color-ink)] hover:text-[var(--color-primary)] transition-colors"
                  >
                    {word.text}
                  </button>
                  <button
                    onClick={() => speak(word.text)}
                    className="p-1.5 text-base rounded-full hover:bg-[var(--color-tint-mint)] transition-colors"
                    title="Произнести"
                    aria-label={`Произнести ${word.text}`}
                  >
                    🔊
                  </button>
                  {word.definitions[0]?.partOfSpeech && (
                    <span className="badge badge-primary">{word.definitions[0].partOfSpeech}</span>
                  )}
                </div>
                <p className="text-[var(--color-slate)] mt-1">{word.definitions[0]?.definition}</p>
                {word.definitions[0]?.example && (
                  <p className="text-[var(--color-slate)] text-sm mt-1 italic">«{word.definitions[0].example}»</p>
                )}
              </div>
              <button
                onClick={() => deleteWord(word.id)}
                className="ml-4 p-2 text-[var(--color-error)] hover:bg-[rgba(217,45,32,0.10)] rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}

export default function DictionaryPage() {
  return (
    <Suspense fallback={
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    }>
      <DictionaryContent />
    </Suspense>
  );
}
