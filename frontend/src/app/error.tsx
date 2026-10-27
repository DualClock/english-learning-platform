'use client';

import { useEffect } from 'react';
import LexiMascot from '@/components/brand/lexi/LexiMascot';
import Button from '@/components/ui/Button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-16">
      <div className="w-full max-w-md rounded-lg border border-hairline bg-canvas p-8 text-center">
        <LexiMascot pose="sleep" className="mx-auto mb-3 w-24" />
        <h1 className="text-h2 text-ink">Что-то пошло не так</h1>
        <p className="mx-auto mt-2 max-w-measure-sm text-body-sm text-slate">
          Книга подождёт. Попробуйте ещё раз — если ошибка повторится, загляните чуть позже.
        </p>
        <div className="mt-6">
          <Button variant="primary" onClick={reset}>
            Попробовать снова
          </Button>
        </div>
      </div>
    </main>
  );
}
