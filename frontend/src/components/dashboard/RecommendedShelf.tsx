'use client';

import { useState } from 'react';
import { API_URL } from '@/app/lib/api-url';

export interface RecommendedBook {
  gutenbergId: number;
  title: string;
  author: string;
  description: string;
  cefrLevel: string;
  alreadyAdded: boolean;
}

interface Props {
  level: string;
  books: RecommendedBook[] | null;
  token?: string;
}

export default function RecommendedShelf({ level, books, token }: Props) {
  const [added, setAdded] = useState<Record<number, boolean>>({});

  if (!level || books === null) {
    return (
      <section className="mb-8">
        <div className="animate-pulse h-5 w-64 bg-[var(--color-tint-mint)] rounded mb-4"></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-5">
              <div className="h-5 w-40 bg-[var(--color-tint-mint)] rounded mb-2"></div>
              <div className="h-3 w-24 bg-[var(--color-tint-mint)] rounded mb-4"></div>
              <div className="h-3 w-full bg-[var(--color-tint-mint)] rounded mb-2"></div>
              <div className="h-3 w-2/3 bg-[var(--color-tint-mint)] rounded mb-4"></div>
              <div className="h-9 w-32 bg-[var(--color-tint-mint)] rounded-lg"></div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (books.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-4">
          Подобрано под ваш уровень {level.toUpperCase()}
        </h2>
        <div className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-8 text-center">
          <p className="text-[var(--color-slate)]">Скоро добавим книги для вашего уровня</p>
        </div>
      </section>
    );
  }

  const addBook = async (gutenbergId: number) => {
    try {
      const res = await fetch(`${API_URL}/api/books/popular/${gutenbergId}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        setAdded((prev) => ({ ...prev, [gutenbergId]: true }));
      }
    } catch (err) {
      console.error('Failed to add recommended book:', err);
    }
  };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-4">
        Подобрано под ваш уровень {level.toUpperCase()}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
        {books.map((book) => {
          const inLibrary = book.alreadyAdded || added[book.gutenbergId];
          return (
            <div
              key={book.gutenbergId}
              className="bg-white rounded-xl border border-[var(--color-hairline-strong)] p-5 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all flex flex-col"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-semibold text-[var(--color-ink)] leading-snug">{book.title}</h3>
                <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-[rgba(249,231,159,0.30)] border border-[var(--color-tint-yellow-bold)] text-[var(--color-ink)]">
                  {book.cefrLevel.toUpperCase()}
                </span>
              </div>
              <p className="text-sm text-[var(--color-slate)] mb-3">{book.author}</p>
              <p className="text-sm text-[var(--color-slate)] line-clamp-2 mb-4 flex-1">{book.description}</p>
              {inLibrary ? (
                <button
                  disabled
                  className="w-full py-2 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium opacity-70 cursor-default"
                >
                  ✓ В библиотеке
                </button>
              ) : (
                <button
                  onClick={() => addBook(book.gutenbergId)}
                  className="w-full py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-pressed)] transition-colors"
                >
                  + В библиотеку
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
