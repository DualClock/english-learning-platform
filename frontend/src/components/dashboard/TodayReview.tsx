import Button from '@/components/ui/Button';
import { CheckCircleIcon, RepeatIcon } from '@/components/ui/icons';
import { plural, pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';

export default function TodayReview({ reviewCount }: { reviewCount: number }) {
  if (reviewCount === 0) {
    return (
      <section className="mb-8">
        <div className="card flex items-center gap-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-accent text-primary">
            <CheckCircleIcon size={24} />
          </span>
          <div className="min-w-0">
            <h2 className="text-h3 text-ink">Всё повторено</h2>
            <p className="mt-1 text-body-sm text-slate">
              Новых слов на сегодня нет — отличный повод почитать что-нибудь интересное.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <div className="card flex flex-col gap-5 sm:flex-row sm:items-center">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-highlight text-primary">
          <RepeatIcon size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-h3 text-ink tabular-nums">
            {formatNumber(reviewCount)} {pluralWords(reviewCount)} {plural(reviewCount, ['ждёт', 'ждут', 'ждут'])} повторения
          </h2>
          <p className="mt-1 text-body-sm text-slate">
            Пара минут сейчас — и эти слова останутся с тобой надолго.
          </p>
        </div>
        <Button href="/review" className="shrink-0">
          Повторить
        </Button>
      </div>
    </section>
  );
}
