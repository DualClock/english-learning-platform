export default function ReaderV3Skeleton() {
  return (
    <div className="reader-sheet" aria-busy="true" aria-label="Открываем книгу">
      <div className="reader-page-pad">
        <div className="mx-auto flex h-full max-w-[780px] flex-col gap-4 pt-4">
          <span className="h-6 w-2/3 animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-full animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-11/12 animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-full animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-3/4 animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="mt-4 h-4 w-full animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-10/12 animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-full animate-pulse rounded bg-[var(--reader-wash)]" />
          <span className="h-4 w-2/3 animate-pulse rounded bg-[var(--reader-wash)]" />
        </div>
      </div>
    </div>
  );
}
