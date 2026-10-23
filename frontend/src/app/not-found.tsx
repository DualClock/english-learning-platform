import Link from 'next/link';
import LexiMascot from '@/components/brand/lexi/LexiMascot';

/*
 * Брендованная 404 вместо пустого ответа Next: статус отдаёт сам фреймворк,
 * а здесь — смысл и два выхода. Ссылка на /test ведёт на публичный тест
 * уровня, который появляется вместе с волной W2.2 (см. docs/beta-launch);
 * до его готовности это единственный заглушенный путь на странице.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-16">
      <div className="w-full max-w-md rounded-lg border border-hairline bg-canvas p-8 text-center">
        <LexiMascot pose="point" className="mx-auto mb-3 w-24" />
        <p className="text-body-sm font-semibold uppercase tracking-wide text-primary">
          404
        </p>
        <h1 className="mt-1 text-h2 text-ink">Такой страницы нет</h1>
        <p className="mx-auto mt-2 max-w-measure-sm text-body-sm text-slate">
          Возможно, ссылку перепутали или книга сменила полку. Начните с главной —
          там всё на месте.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className="btn-primary px-5 py-2.5">
            На главную
          </Link>
          <Link
            href="/test"
            className="inline-flex items-center justify-center rounded-lg border border-hairline px-5 py-2.5 text-body-sm font-semibold text-ink transition-colors duration-fast ease-soft hover:border-primary hover:text-primary"
          >
            Проверить уровень за 3 минуты
          </Link>
        </div>
      </div>
    </main>
  );
}
