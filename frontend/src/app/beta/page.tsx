import type { Metadata } from 'next';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Notice from '@/components/ui/Notice';
import LexiPeek from '@/components/brand/lexi/LexiPeek';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  ClockIcon,
  MailIcon,
  RepeatIcon,
} from '@/components/ui/icons';
import { siteUrl, siteDescription } from '@/lib/site';
import {
  COHORT_DAILY_MINUTES,
  COHORT_DAYS,
  COHORT_SEATS,
  COHORT_START_ISO,
  checkpointSchedule,
  COHORT_FAQ,
  cohortEndIso,
  cohortPhase,
  formatRuDate,
  formatRuDay,
  isoFromDate,
} from '@/lib/beta';

/*
 * Страница когорты (W3.3) — единая цель всех писем и постов из аутрич-кита.
 *
 * Холодный «заходи когда хочешь» не конвертирует: человеку нужна причина
 * зарегистрироваться сегодня. Причина — когорта с датой старта и честным
 * лимитом мест, поэтому страница:
 *
 *   1) серверная и без авторизации — `/beta` нет в matcher'е middleware, а весь
 *      текст лежит в HTML до JavaScript (требование из docs/beta-launch/SEO_AUDIT.md:
 *      на лендинге H2 ниже сгиба прятались в `Reveal` под `opacity: 0`);
 *   2) объясняет условия за 20 секунд — по одному экрану на блок, без абзацев
 *      «расскажите о впечатлениях»;
 *   3) не врёт про дефицит: счётчика остатка мест нет, потому что нет и
 *      живой логики остатка (см. COHORT_SEATS в src/lib/beta.ts).
 *
 * Ритм и оболочка — как у /test и у правовых страниц: то же поле bg-ground-warm,
 * та же шапка с «Войти», тот же подвал со ссылками на правила и политику.
 */
export const metadata: Metadata = {
  title: 'Когорта беты: 14 дней чтения со 2 ноября',
  description:
    'Закрытая когорта Lexicon: 14 дней чтения по главе в день, старт 2 ноября 2026, ' +
    `15–20 минут в день и ${COHORT_SEATS} мест. Книги, перевод слов по клику и повторение — бесплатно и без карты.`,
  alternates: { canonical: '/beta' },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: `${siteUrl}/beta`,
    title: 'Когорта беты: 14 дней чтения со 2 ноября',
    description: siteDescription,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Lexi машет рукой рядом с надписью «Английский без зубрёжки»',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Когорта беты: 14 дней чтения со 2 ноября',
    description: siteDescription,
    images: ['/og.png'],
  },
};

const START_ISO = COHORT_START_ISO;
const END_ISO = cohortEndIso();
const START_DATE = formatRuDate(START_ISO);
const END_DATE = formatRuDate(END_ISO);
const SCHEDULE = checkpointSchedule();

/**
 * Что происходит — четыре факта, которые человек проверяет до регистрации.
 * Иконка здесь не украшение: список читают по диагонали, и глазу нужно
 * зацепиться за строку.
 */
const RHYTHM = [
  {
    icon: BookOpenIcon,
    title: 'Глава в день',
    text:
      'Со 2 по 15 ноября каждый день — своя глава. Не «когда получится», а все вместе: отстали на два дня — догнали в свой темп, никто вас за это не выгоняет.',
  },
  {
    icon: ClockIcon,
    title: '15–20 минут',
    text:
      'Ровно столько уходит на главу вместе с кликами по незнакомым словам. В плохой день — две минуты на карточки повторения, чтобы не потерять очередь.',
  },
  {
    icon: RepeatIcon,
    title: 'Слова возвращаются сами',
    text:
      'Нажали на слово и добавили его в словарь — алгоритм вернёт его завтра, потом через ' +
      'шесть дней, и интервал будет расти. Помнить про повторение не вам.',
  },
  {
    icon: CheckIcon,
    title: 'Бесплатно и без карты',
    text:
      'Платных экранов в продукте нет, карту прикрепить некуда. Библиотека, свои EPUB и перевод слов открыты с первого дня.',
  },
];

/** Единственное, что мы просим взамен. */
const ASKS = [
  {
    title: 'Читать',
    text:
      'Главу в день. Пропустить день можно и догнать вечером; бросить тоже можно — просто напишите, и мы не будем присылать напоминания тому, кто ушёл.',
  },
  {
    title: 'Отмечать слова',
    text:
      'Клик по незнакомому слову → перевод → «в словарь». Это не формальность: повторение работает ровно над тем, что вы реально встретили, и по вашим словам мы видим, где текст сложнее, чем казался.',
  },
  {
    title: 'Оставить два коротких отзыва',
    text:
      'Кнопка «Отзыв» уже вшита в приложение. Нужны конкретные фразы, а не «расскажите о впечатлениях» — формулировки обоих отзывов приведены ниже, в расписании.',
  },
];

/** Что участник получает за два отзыва и две недели дисциплины. */
const GETS = [
  {
    title: 'Книги и повторение без денег',
    text:
      'Публичная классика и ваши EPUB в той же читалке, словарь, интервальное повторение, тест уровня — всё открыто, пока вы в бете.',
  },
  {
    title: 'Личная линия с разработчиком',
    text:
      'Отвечает тот, кто это делает, а не поддержка по скрипту: hello@lexicon.app и кнопка «Отзыв» ведут к одному человеку. Правки по таким письмам обычно идут в часах, а не в неделях.',
  },
  {
    title: 'Правки по вашей группе — первыми',
    text:
      'Если о проблеме пишут несколько человек из когорты, она попадает в ближайший релиз раньше остального фидбека. Вы не ждёте очереди к Roadmap.',
  },
  {
    title: 'Имя в списке благодарностей',
    text:
      'В финальном посте беты — список тех, кто прошёл все 14 дней. Хотите остаться без имени — скажите в отзыве, это нормально.',
  },
];

export default function BetaPage() {
  /*
   * Фаза считается на сервере от даты сборки: страница статическая, и «сегодня»,
   * которое она может знать без JavaScript, — это день деплоя. После старта
   * когорты этот переключатель сам меняет первую строку и подпись под датой
   * старта; дальше правка только за текстом (см. комментарий в src/lib/beta.ts).
   */
  const phase = cohortPhase(isoFromDate(new Date()));
  const eyebrow =
    phase === 'signups'
      ? 'Lexicon · закрытая когорта · набор открыт'
      : phase === 'reading'
        ? 'Lexicon · закрытая когорта · читает прямо сейчас'
        : 'Lexicon · закрытая когорта · первая волна прочитана';
  const seatsLeftLine =
    phase === 'signups'
      ? `Мест ${COHORT_SEATS}. Регистрация закрывается, когда они займут, — или в день старта, если место ещё свободно.`
      : `Мест было ${COHORT_SEATS}. Набор первой волны закрыт, условия ниже — они же про любую следующую когорту.`;

  return (
    <div className="flex min-h-screen flex-col bg-ground-warm text-ink">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="font-heading text-h3 font-bold text-ink">
          Lexicon
        </Link>
        <Link
          href="/login"
          className="text-body-sm text-charcoal transition-colors duration-fast ease-soft hover:text-ink"
        >
          Войти
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 sm:px-6">
        {/*
         * Заголовок + одна строка объяснения. Дальше человек либо читает
         * условия, либо уже идёт к CTA — оба варианта должны работать с экрана.
         */}
        <div className="card p-5 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <p className="text-body-sm font-semibold uppercase tracking-wide text-primary">
              {eyebrow}
            </p>
            <LexiPeek mood="happy" className="w-20 shrink-0 sm:w-24" />
          </div>
          <h1 className="mt-2 font-heading text-h1 text-ink">
            Когорта Lexicon: 14 дней чтения, старт {formatRuDay(START_ISO)}
          </h1>
          <p className="mt-3 max-w-measure text-body-lg text-slate">
            Собираем {COHORT_SEATS} человек, которые две недели читают на английском в одном
            ритме: по главе в день, {COHORT_DAILY_MINUTES.toLowerCase()}, два коротких отзыва.
            Книги, перевод слова по клику и повторение — бесплатно и без карты.
          </p>

          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
              <dt className="text-caption uppercase tracking-wide text-slate">Старт</dt>
              <dd className="mt-1 text-body font-semibold text-ink">
                <time dateTime={START_ISO}>{START_DATE}</time>
              </dd>
            </div>
            <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
              <dt className="text-caption uppercase tracking-wide text-slate">Финиш</dt>
              <dd className="mt-1 text-body font-semibold text-ink">
                <time dateTime={END_ISO}>{END_DATE}</time>
              </dd>
            </div>
            <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
              <dt className="text-caption uppercase tracking-wide text-slate">Мест</dt>
              <dd className="mt-1 text-body font-semibold text-ink">{COHORT_SEATS}</dd>
            </div>
          </dl>
        </div>

        <section className="mt-8" aria-labelledby="beta-rhythm">
          <h2 id="beta-rhythm" className="text-h3 text-ink">
            Что происходит
          </h2>
          <ul className="mt-3 space-y-2">
            {RHYTHM.map(({ icon: Icon, title, text }) => (
              <li
                key={title}
                className="flex gap-3 rounded-lg border border-hairline bg-canvas px-4 py-3"
              >
                <Icon size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-ink">{title}</span>
                  <span className="mt-1 block max-w-measure text-body-sm text-charcoal">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8" aria-labelledby="beta-asks">
          <h2 id="beta-asks" className="text-h3 text-ink">
            Что нужно от участника
          </h2>
          <ol className="mt-3 space-y-3">
            {ASKS.map((ask, index) => (
              <li key={ask.title} className="flex gap-4 rounded-lg border border-hairline bg-canvas px-4 py-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface text-caption font-semibold text-primary"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-ink">{ask.title}</span>
                  <span className="mt-1 block max-w-measure text-body-sm text-charcoal">{ask.text}</span>
                </span>
              </li>
            ))}
          </ol>

          {/*
           * Расписание отзывов: даты текстом, а не цветом — на случай
           * «уменьшить анимацию», высокой контрастности и просто печати.
           */}
          <div className="mt-4 rounded-lg border border-hairline bg-canvas p-4">
            <h3 className="text-body font-semibold text-ink">Когда именно нужны отзывы</h3>
            <ul className="mt-2 space-y-2">
              {SCHEDULE.map((checkpoint) => (
                <li key={checkpoint.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-body-sm font-semibold text-ink">
                    День {checkpoint.day} · <time dateTime={checkpoint.iso}>{checkpoint.dateLabel}</time>
                  </span>
                  <span className="min-w-0 max-w-measure text-body-sm text-charcoal">
                    {checkpoint.ask}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-caption text-slate">
              {COHORT_DAYS} дней чтения: со {formatRuDay(START_ISO)} по {formatRuDay(END_ISO)}. Между
              отзывами ничего сдавать не нужно — ни план, ни скриншоты, ни отчёт о прогрессе.
            </p>
          </div>
        </section>

        <section className="mt-8" aria-labelledby="beta-gets">
          <h2 id="beta-gets" className="text-h3 text-ink">
            Что получает участник
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {GETS.map((item) => (
              <li key={item.title} className="rounded-lg border border-hairline bg-canvas px-4 py-3">
                <span className="flex items-center gap-2">
                  <CheckIcon size={16} className="shrink-0 text-primary" aria-hidden />
                  <span className="text-body font-semibold text-ink">{item.title}</span>
                </span>
                <span className="mt-1 block max-w-measure text-body-sm text-charcoal">{item.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8" aria-labelledby="beta-seats">
          <h2 id="beta-seats" className="text-h3 text-ink">
            Честно про лимит
          </h2>
          <p className="mt-3 max-w-measure text-body text-charcoal">
            Мест {COHORT_SEATS}, потому что я лично читаю все отзывы и разбираю каждую проблему.
            Это не маркетинговый дефицит, а ровно столько, сколько успевает один человек за{' '}
            {COHORT_DAYS} дней.
          </p>
          <div className="mt-3">
            <Notice tone="info">
              <p>
                Живого счётчика «сколько мест осталось» на этой странице нет: в продукте нет и
                логики остатка, а врать про дефицит, который мы не считаем, — самый короткий
                способ потерять доверие когорты.
              </p>
              <p>{seatsLeftLine}</p>
              <p>
                Чего мы не обещаем: цены и условий после беты. Их решают по итогам двух недель, и
                всем зарегистрированным напишут в тот день, когда станет известно.
              </p>
            </Notice>
          </div>
        </section>

        <section className="mt-8" aria-labelledby="beta-cta">
          <h2 id="beta-cta" className="sr-only">
            Как войти
          </h2>
          <div className="card p-5 sm:p-6">
            <p className="max-w-measure text-body-lg text-ink">
              Сначала — польза без регистрации. Пройдите тест уровня за три минуты, он ничего не
              сохраняет; если уровень и формат подходят, вступайте в когорту со страницы
              регистрации.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button href="/onboarding" className="px-6 py-3 text-body">
                Вступить в когорту
                <ArrowRightIcon size={20} aria-hidden />
              </Button>
              <Button href="/test" variant="secondary" className="px-6 py-3 text-body">
                Пройти тест уровня за 3 минуты
              </Button>
            </div>
            <p className="mt-4 text-caption text-slate">
              Правила беты и политику данных можно прочитать до регистрации — обе страницы
              публичные, ссылки в подвале.
            </p>
          </div>
        </section>

        <section className="mt-10" aria-labelledby="beta-faq">
          <h2 id="beta-faq" className="text-h3 text-ink">
            Вопросы, которые задают первыми
          </h2>
          <div className="mt-3 space-y-3">
            {COHORT_FAQ.map((item) => (
              <div key={item.id} className="rounded-lg border border-hairline bg-canvas px-4 py-4">
                <h3 id={item.id} className="text-body font-semibold text-ink">
                  {item.question}
                </h3>
                <p className="mt-2 max-w-measure text-body-sm text-charcoal">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pb-10 sm:px-6">
        <nav
          aria-label="Подвал"
          className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-sm text-charcoal"
        >
          <Link
            href="/privacy"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Конфиденциальность
          </Link>
          <Link
            href="/terms"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Правила беты
          </Link>
          <Link
            href="/test"
            className="underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
          >
            Тест уровня
          </Link>
        </nav>
        <a
          href="mailto:hello@lexicon.app"
          className="inline-flex items-center gap-2 text-body-sm text-charcoal underline decoration-hairline-strong underline-offset-4 transition-colors duration-fast ease-soft hover:text-ink"
        >
          <MailIcon size={16} aria-hidden />
          hello@lexicon.app
        </a>
      </footer>
    </div>
  );
}
