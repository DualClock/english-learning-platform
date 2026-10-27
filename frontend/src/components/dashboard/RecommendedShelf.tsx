'use client';

import { useState } from 'react';
import { API_URL } from '@/app/lib/api-url';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/LoadingState';
import { Tag } from '@/components/ui/Badge';
import { CheckIcon, PlusIcon } from '@/components/ui/icons';

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

  const heading = (
    <h2 className="mb-4 text-h3 text-ink">Подобрано под ваш уровень {level.toUpperCase()}</h2>
  );

  if (!level || books === null) {
    return (
      <section className="mb-8" aria-busy="true">
        <Skeleton className="mb-4 h-6 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-11 w-full" />
            </Card>
          ))}
        </div>
      </section>
    );
  }

  if (books.length === 0) {
    return (
      <section className="mb-8">
        {heading}
        <EmptyState
          variant="inline"
          title="На этот уровень книг пока нет"
          description="Загляните в библиотеку — там классика public domain."
        />
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
      {heading}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {books.map((book) => {
          const inLibrary = book.alreadyAdded || added[book.gutenbergId];
          return (
            <Card key={book.gutenbergId} as="article" className="flex flex-col">
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="text-h3 text-ink">{book.title}</h3>
                <Tag tone="warning" className="shrink-0">
                  {book.cefrLevel.toUpperCase()}
                </Tag>
              </div>
              <p className="mb-3 text-body-sm text-slate">{book.author}</p>
              <p className="mb-5 line-clamp-2 flex-1 text-body-sm text-charcoal">{book.description}</p>
              {inLibrary ? (
                <Button variant="secondary" disabled className="w-full">
                  <CheckIcon size={16} />
                  В библиотеке
                </Button>
              ) : (
                <Button onClick={() => addBook(book.gutenbergId)} className="w-full">
                  <PlusIcon size={16} />
                  В библиотеку
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
