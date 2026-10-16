'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';

interface WordList {
  id: number;
  name: string;
  description?: string;
  cefrFrom?: string;
  cefrTo?: string;
  itemCount: number;
  learnedCount: number;
}

export default function WordListsSection() {
  const { data: session } = useSession();
  const [lists, setLists] = useState<WordList[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const token = session?.accessToken;
        const res = await fetch(`${API_URL}/api/wordlists`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load wordlists');
        const data = await res.json();
        setLists(Array.isArray(data) ? data : []);
      } catch {
        setError('Не удалось загрузить сборники. Попробуйте обновить страницу.');
        setLists([]);
      }
    };
    if (session) load();
  }, [session]);

  if (error) {
    return (
      <div className="card p-12 text-center">
        <p className="text-[#5A5F5A] mb-4">{error}</p>
        <button onClick={() => { setError(''); setLists(null); window.location.reload(); }} className="btn-secondary">
          Попробовать снова
        </button>
      </div>
    );
  }

  if (lists === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="card p-6 animate-pulse">
            <div className="h-5 bg-[#D6D3CC]/40 rounded w-2/3 mb-3"></div>
            <div className="h-4 bg-[#D6D3CC]/40 rounded w-full mb-2"></div>
            <div className="h-4 bg-[#D6D3CC]/40 rounded w-4/5 mb-4"></div>
            <div className="h-6 bg-[#D6D3CC]/40 rounded w-1/3 mb-4"></div>
            <div className="h-2 bg-[#D6D3CC]/40 rounded w-full mb-2"></div>
            <div className="h-4 bg-[#D6D3CC]/40 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (lists.length === 0) {
    return (
      <div className="card p-12 text-center">
        <p className="text-[#5A5F5A]">Сборники скоро появятся</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {lists.map((list) => {
        const percent = list.itemCount > 0 ? Math.round((list.learnedCount / list.itemCount) * 100) : 0;
        return (
          <div key={list.id} className="card p-6 flex flex-col hover:shadow-md transition-shadow">
            <h3 className="text-lg font-bold text-[#20231F] mb-2">{list.name}</h3>
            {list.description && (
              <p className="text-sm text-[#5A5F5A] mb-3 line-clamp-3">{list.description}</p>
            )}
            <div className="flex items-center gap-2 mb-4">
              <span className="badge badge-primary">{list.cefrFrom}–{list.cefrTo}</span>
            </div>
            <div className="mt-auto">
              <div className="flex items-center justify-between text-sm text-[#5A5F5A] mb-1">
                <span>{list.learnedCount.toLocaleString('ru-RU')} / {list.itemCount.toLocaleString('ru-RU')} изучено</span>
                <span>{percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-[#D6D3CC]/40 overflow-hidden mb-4">
                <div className="h-full rounded-full bg-[#356B52] transition-all" style={{ width: `${percent}%` }}></div>
              </div>
              <a href={`/dictionary/lists/${list.id}`} className="btn-primary w-full text-center">
                Открыть
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
