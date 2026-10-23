'use client';

/**
 * Заглушка повторяет комнату читальни: тёмная полка, бумага, верхняя панель
 * и подвал. Текст встаёт на своё место, а не сдвигает панели после загрузки.
 */
export default function ReaderSkeleton() {
  const lines = [96, 88, 94, 78, 90, 84, 92, 68, 86, 80, 88, 74];
  const railLines = [40, 88, 72, 84, 60, 78, 66, 82, 58, 74, 70];

  return (
    <div
      className="reader-room flex h-[100dvh] w-full overflow-hidden"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Загрузка книги</span>

      <div className="hidden w-[288px] shrink-0 bg-navy px-5 py-4 lg:block">
        <div className="mb-8 flex items-center gap-2">
          <div className="h-4 w-16 rounded bg-white/15" />
        </div>
        <div className="mb-6 flex gap-4">
          <div className="h-[86px] w-[60px] shrink-0 rounded-[3px] bg-[#F2E7D2]/15" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-3.5 w-full rounded bg-white/15" />
            <div className="h-3.5 w-4/5 rounded bg-white/15" />
            <div className="h-2.5 w-1/2 rounded bg-white/10" />
          </div>
        </div>
        <div className="mb-7 space-y-2">
          <div className="h-2.5 w-full rounded bg-white/10" />
          <div className="h-1 w-full rounded-full bg-white/15" />
        </div>
        <div className="mb-4 flex gap-2">
          <div className="h-3 w-16 rounded bg-white/15" />
          <div className="h-3 w-12 rounded bg-white/10" />
        </div>
        <div className="space-y-2.5">
          {railLines.map((width, index) => (
            <div
              key={index}
              className="h-2.5 rounded bg-white/10"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--reader-hairline)] px-4">
          <div className="h-5 w-5 rounded bg-[var(--reader-hairline)]" />
          <div className="h-3 w-32 rounded bg-[var(--reader-hairline)]" />
          <div className="ml-auto flex gap-2">
            <div className="h-8 w-8 rounded bg-[var(--reader-hairline)]" />
            <div className="h-8 w-8 rounded bg-[var(--reader-hairline)]" />
            <div className="h-8 w-8 rounded bg-[var(--reader-hairline)]" />
          </div>
        </div>

        <div className="reader-paper flex-1 overflow-hidden px-5 pt-10 sm:px-8 sm:pt-14 lg:px-12">
          <div className="mx-auto w-full max-w-[62ch] space-y-4">
            {lines.map((width, index) => (
              <div
                key={index}
                className="h-3.5 rounded bg-[var(--reader-hairline)] opacity-70"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        </div>

        <div className="flex h-14 shrink-0 items-center justify-between border-t border-[var(--reader-hairline)] px-4">
          <div className="h-3 w-12 rounded bg-[var(--reader-hairline)]" />
          <div className="h-3 w-32 rounded bg-[var(--reader-hairline)]" />
          <div className="h-8 w-16 rounded bg-[var(--reader-hairline)]" />
        </div>
      </div>
    </div>
  );
}
