import Button from '@/components/ui/Button';
import { CheckCircleIcon, RepeatIcon, AlertIcon } from '@/components/ui/icons';
import { plural, pluralWords } from '@/lib/plural';
import { formatNumber } from '@/lib/format';
import {
  reviewDescription,
  reviewHeadline,
  type WidgetState,
} from '@/components/dashboard/dashboard-state';

/*
 * Блок повторения.
 *
 * Раньше он получал только число и при `0` писал «Всё повторено». Ноль
 * приходил из двух разных ситуаций: у нового аккаунта (нет слов) и у
 * пользователя, у которого упал запрос (`reviewToday?.totalCount ?? 0`).
 * Второй случай — прямая ложь про состояние сервиса, и читалась она как
 * «здесь нечего делать».
 *
 * Теперь состояние приходит снаружи — `loading` / `error` / `empty` / `ready`,
 * и только `ready` говорит о числах. «Всё повторено» осталось ровно для того
 * случая, когда человек действительно всё повторил.
 */
interface Props {
  state: WidgetState;
  reviewCount: number;
  onRetry?: () => void;
}

export default function TodayReview({ state, reviewCount, onRetry }: Props) {
  if (state === 'loading') {
    return (
      <section className="mb-8">
        <div className="card flex items-center gap-5" aria-busy="true">
          <span className="h-14 w-14 shrink-0 rounded-lg bg-surface" />
          <div className="min-w-0 flex-1">
            <div className="mb-2 h-5 w-56 rounded bg-surface" />
            <div className="h-4 w-72 rounded bg-surface" />
          </div>
        </div>
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section className="mb-8">
        <div className="card flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface text-semantic-error">
            <AlertIcon size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-h3 text-ink">{reviewHeadline(state, reviewCount)}</h2>
            <p className="mt-1 text-body-sm text-slate">{reviewDescription(state, reviewCount)}</p>
          </div>
          {onRetry && (
            <Button variant="secondary" onClick={onRetry} className="shrink-0">
              Обновить
            </Button>
          )}
        </div>
      </section>
    );
  }

  if (state === 'empty' || reviewCount === 0) {
    return (
      <section className="mb-8">
        <div className="card flex items-center gap-5">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-accent text-primary">
            <CheckCircleIcon size={24} />
          </span>
          <div className="min-w-0">
            <h2 className="text-h3 text-ink">
              {state === 'empty' ? reviewHeadline(state, 0) : 'Всё повторено'}
            </h2>
            <p className="mt-1 text-body-sm text-slate">{reviewDescription(state, 0)}</p>
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
          <p className="mt-1 text-body-sm text-slate">{reviewDescription(state, reviewCount)}</p>
        </div>
        <Button href="/review" className="shrink-0">
          Повторить
        </Button>
      </div>
    </section>
  );
}
