import LoadingState from '@/components/ui/LoadingState';
import { Skeleton } from '@/components/ui/LoadingState';

/**
 * Загрузка словаря повторяет будущую страницу: заголовок, строка поиска и список слов.
 * Пустой экран на секунду читается как ошибка, поэтому скелетон — не украшение, а состояние.
 */
export default function DictionarySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загрузка словаря</span>
      <div className="page-header">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="mt-3 h-4 w-32" />
      </div>
      <Skeleton className="mb-6 h-4 w-56" />
      <div className="card mb-6 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Skeleton className="h-11 flex-1" />
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-32" />
        </div>
      </div>
      <LoadingState rows={6} label="Загрузка слов" />
    </div>
  );
}
