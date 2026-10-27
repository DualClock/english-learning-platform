import { Skeleton } from '@/components/ui/LoadingState';

/** Заготовка совпадает по форме с настоящим дашбордом, чтобы вход данных не сдвигал вёрстку. */
export default function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-10">
        <Skeleton className="mb-2 h-3 w-32" />
        <Skeleton className="mb-3 h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Skeleton className="mb-4 h-6 w-44" />
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card flex items-center gap-4">
            <Skeleton className="h-11 w-11 shrink-0 rounded-md" />
            <div className="min-w-0 grow space-y-2">
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>

      <Skeleton className="mb-4 h-6 w-44" />
      <div className="card mb-8 flex flex-col gap-6 sm:flex-row">
        <Skeleton className="h-40 w-28 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-2 w-full max-w-measure-sm rounded-full" />
          <Skeleton className="h-11 w-40 rounded-md" />
        </div>
      </div>

      <Skeleton className="mb-4 h-6 w-40" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <Skeleton className="h-10 w-10 rounded-md" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
