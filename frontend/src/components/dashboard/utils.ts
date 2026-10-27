export interface Book {
  id: number;
  title: string;
  author?: string;
  language?: string;
  fileSize: number;
  createdAt: string;
  progress?: number;
  currentPage?: number;
  totalPages?: number;
  coverUrl?: string;
}

export function pickContinueBook(books: Book[]): Book | undefined {
  const inProgress = books
    .filter((b) => (b.progress ?? 0) > 0 && (b.progress ?? 0) < 100)
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
  if (inProgress.length > 0) return inProgress[0];
  return [...books].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
}
