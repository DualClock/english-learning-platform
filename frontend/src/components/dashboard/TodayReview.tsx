import Link from 'next/link';
import { pluralize } from './utils';

export default function TodayReview({ reviewCount }: { reviewCount: number }) {
  if (reviewCount > 0) {
    return (
      <section className="mb-8">
        <div className="bg-white rounded-2xl border border-[var(--color-hairline-strong)] p-6 shadow-sm flex flex-col sm:flex-row sm:items-center gap-5 hover:shadow-md transition-shadow duration-200">
          <div className="w-14 h-14 rounded-2xl bg-[rgba(249,231,159,0.30)] flex items-center justify-center shrink-0">
            <svg className="w-7 h-7 text-[var(--color-primary-pressed)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {reviewCount} {pluralize(reviewCount, 'слово', 'слова', 'слов')} ждут повторения
            </h2>
            <p className="text-sm text-[var(--color-slate)] mt-1">
              Пара минут сейчас — и эти слова останутся с тобой надолго.
            </p>
          </div>
          <Link href="/review" className="btn-primary shrink-0">
            Повторить
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="bg-white rounded-2xl border border-dashed border-[var(--color-hairline-strong)] p-6 flex items-center gap-5">
        <div className="w-14 h-14 rounded-2xl bg-[var(--color-tint-mint)] flex items-center justify-center shrink-0">
          <svg className="w-7 h-7 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">Всё повторено!</h2>
          <p className="text-sm text-[var(--color-slate)] mt-1">
            Новых слов на сегодня нет — отличный повод почитать что-нибудь интересное.
          </p>
        </div>
      </div>
    </section>
  );
}
