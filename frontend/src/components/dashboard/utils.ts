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

export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
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
