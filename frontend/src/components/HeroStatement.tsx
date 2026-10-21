import Link from 'next/link';

/** Строки заявления. Переносы авторские: маска работает построчно. */
const LINES = ['Учи английский', 'через книги,', 'а не учебники'];

export default function HeroStatement() {
  return (
    <div>
      <h1 className="relative z-10 text-display text-ink">
        {LINES.map((line) => (
          <span key={line} className="mask-line">
            <span>{line}</span>
          </span>
        ))}
      </h1>

      <div className="mask-after mt-14 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-measure text-body-lg text-charcoal">
          Читай настоящую литературу, нажимай на незнакомые слова — ИИ переведёт
          их с учётом контекста, а система сама подстроит повторения под твою память.
        </p>
        <div className="flex items-center gap-6 shrink-0">
          <Link href="/onboarding" className="btn-primary">
            Начать читать
          </Link>
          <Link
            href="/login"
            className="text-body-sm text-slate underline decoration-hairline-strong underline-offset-4 hover:text-ink hover:decoration-ink transition-colors duration-fast ease-soft"
          >
            У меня есть аккаунт
          </Link>
        </div>
      </div>
    </div>
  );
}
