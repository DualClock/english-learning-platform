/** Формат пагинированных списков API: { items, page, pageSize, totalCount, totalPages } */
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export function isPaged<T>(value: unknown): value is Paged<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Paged<T>).items) &&
    typeof (value as Paged<T>).totalCount === 'number'
  );
}
