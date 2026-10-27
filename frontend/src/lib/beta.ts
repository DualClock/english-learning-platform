/*
 * Когорта закрытой беты (W3.3) — условия, расписание и FAQ в одном месте.
 *
 * /beta — единая цель всех писем и постов из docs/beta-launch/OUTREACH_KIT.md:
 * человек приходит по ссылке из чужого канала и за 20 секунд должен понять, на
 * что он подписывается. Значит условия (дата старта, число мест, два отзыва)
 * живут не в восьми строках JSX, а здесь: сдвинули старт — правится один файл,
 * и вместе с ним даты в тексте, в расписании и в юнитах.
 *
 * Чистая логика вынесена ради проверок: `beta.test.mjs` сверяет расписание с
 * планом запуска, следит за id секций и не даёт странице пообещать то, чего в
 * продукте нет (список ниже — он же стоп-сигнал для будущих правок).
 */

/** День 1. Понедельник, 2 ноября 2026 — см. docs/beta-launch/BETA_LAUNCH_PLAN.md. */
export const COHORT_START_ISO = '2026-11-02';

/** Сколько дней идёт когорта: 14 глав, со 2 по 15 ноября включительно. */
export const COHORT_DAYS = 14;

/**
 * Мест ровно столько, сколько один человек успевает разобрать за две недели.
 *
 * Это статическое число, а не счётчик: живой логики «сколько мест свободно» в
 * продукте нет (нет таблицы мест, нет резервирования при регистрации). Поэтому
 * на странице не может быть и «осталось 12 мест» — врать про дефицит, который
 * мы не считаем, дешевле всего один раз.
 */
export const COHORT_SEATS = 80;

/** Обещание по времени читается как диапазон, а не как «час в день». */
export const COHORT_DAILY_MINUTES = '15–20 минут';

/** Русские месяцы в родительном падеже: «2 ноября», а не «2 November». */
const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO-дата в UTC-миллисекунды. Несуществующий день (31 февраля) — ошибка. */
function toUtc(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (!match) {
    throw new TypeError(`beta: дата обязана быть в формате YYYY-MM-DD, получено «${iso}»`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new TypeError(`beta: несуществующая дата «${iso}»`);
  }
  return time;
}

function fromUtc(time: number): string {
  const date = new Date(time);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** Прибавить дни к ISO-дате без перехода через локальный часовой пояс. */
export function addIsoDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * 86_400_000);
}

/**
 * ISO-дата из объекта Date. Нужна странице /beta, чтобы определить фазу когорты
 * на сервере: у статической страницы «сегодня» — это день сборки, другого
 * часового механизма без JavaScript у неё нет. Считаем по UTC: расхождение с
 * московской полуностью — максимум несколько часов на границе фазы, и оно
 * перекрывается тем, что страница всё равно пересобирается при деплое.
 */
export function isoFromDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('beta: дата невалидна, невозможно определить фазу когорты');
  }
  return fromUtc(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Даты всех дней когорты: cohortDates()[0] — день 1, последний — день 14. */
export function cohortDates(startIso: string = COHORT_START_ISO, days: number = COHORT_DAYS): string[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new TypeError(`beta: дней когорты обязано быть целым и не меньше 1, получено «${days}»`);
  }
  return Array.from({ length: days }, (_, index) => addIsoDays(startIso, index));
}

/** Последний день когорты: на него приходится второй отзыв. */
export function cohortEndIso(
  startIso: string = COHORT_START_ISO,
  days: number = COHORT_DAYS,
): string {
  return cohortDates(startIso, days)[days - 1];
}

/** «2 ноября» — для строк расписания. */
export function formatRuDay(iso: string): string {
  const date = new Date(toUtc(iso));
  return `${date.getUTCDate()} ${MONTHS_GENITIVE[date.getUTCMonth()]}`;
}

/** «2 ноября 2026 года» — для единственного упоминания старта в тексте. */
export function formatRuDate(iso: string): string {
  const date = new Date(toUtc(iso));
  return `${date.getUTCDate()} ${MONTHS_GENITIVE[date.getUTCMonth()]} ${date.getUTCFullYear()} года`;
}

export type CohortPhase = 'signups' | 'reading' | 'finished';

/**
 * Фаза когорты по конкретной дате. Отдельная функция, а не разовое «до/после»
 * в JSX: страница живёт в индексе месяцами, и текст после старта обязан меняться
 * по одному правилу, а не по настроению того, кто её правит.
 */
export function cohortPhase(iso: string): CohortPhase {
  const day = cohortDayNumber(iso);
  if (day !== null) return 'reading';
  return toUtc(iso) < toUtc(COHORT_START_ISO) ? 'signups' : 'finished';
}

/** Номер дня внутри когорты (1…14) или null, если дата вне её окна. */
export function cohortDayNumber(iso: string): number | null {
  const time = toUtc(iso);
  const start = toUtc(COHORT_START_ISO);
  const index = Math.round((time - start) / 86_400_000) + 1;
  return index >= 1 && index <= COHORT_DAYS ? index : null;
}

/**
 * Два отзыва — единственное, что мы просим у участника взамен бесплатных книг.
 * Дни и конкретные формулировки взяты из `docs/beta-launch/OUTREACH_KIT.md`
 * (2–3 вопроса дают 15,97% ответов против 6,87% при семи и больше). «Расскажите
 * о впечатлениях» здесь быть не может: такой отзыв ни на что не пригоден.
 */
export interface FeedbackCheckpoint {
  id: string;
  day: number;
  title: string;
  ask: string;
}

export const FEEDBACK_CHECKPOINTS: FeedbackCheckpoint[] = [
  {
    id: 'feedback-day-4',
    day: 4,
    title: 'Отзыв на четвёртый день',
    ask: 'Что бесит сильнее всего: перевод слова, очередь повторения или сама глава? Достаточно одной фразы.',
  },
  {
    id: 'feedback-day-14',
    day: 14,
    title: 'Отзыв в последний день',
    ask: 'Какую книгу ты хочешь прочитать следующей и что в этих двух неделях оставить как есть.',
  },
];

export interface ScheduledCheckpoint extends FeedbackCheckpoint {
  iso: string;
  dateLabel: string;
}

/** Чекпоинты с реальными датами: день 4 → 5 ноября, день 14 → 15 ноября. */
export function checkpointSchedule(
  startIso: string = COHORT_START_ISO,
): ScheduledCheckpoint[] {
  return FEEDBACK_CHECKPOINTS.map((checkpoint) => {
    const iso = addIsoDays(startIso, checkpoint.day - 1);
    return { ...checkpoint, iso, dateLabel: formatRuDay(iso) };
  });
}

/** Одна запись FAQ: id держим стабильным — на него ссылается aria-labelledby. */
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/**
 * Ответы переформулированы из `materials/FAQ-during-beta.md` (вопросы №2, №3,
 * №4, №5, №6, №12) и сверены с кодом: удаление аккаунта уже кнопка в
 * настройках (`Controllers/AccountController.cs`), приложений в сторах нет,
 * EPUB — единственный принимаемый формат.
 */
export const COHORT_FAQ: FaqItem[] = [
  {
    id: 'beta-faq-free',
    question: 'Почему бесплатно? В чём подвох?',
    answer:
      'Подвоха нет, есть стадия: когорте нужно две недели живого чтения, чтобы увидеть, где сервис ломается и где бесит. Платных экранов в продукте нет, карту прикрепить некуда — с вас только два коротких отзыва.',
  },
  {
    id: 'beta-faq-data',
    question: 'Что вы сделаете с моей почтой и данными?',
    answer:
      'Почта — это логин и способ вернуть пароль; рассылки «500 книг для вас» нет, адреса никому не передаются. Сторонних счётчиков в коде тоже нет: события аналитики улетают на наш же сервер. Удалить аккаунт со всеми словами и файлами можно кнопкой в настройках.',
  },
  {
    id: 'beta-faq-epub',
    question: 'Можно читать свою книгу?',
    answer:
      'Да: EPUB загружается в библиотеку и читается с теми же кликами по словам, словарём и повторением. Других форматов нет, а DRM-книга из платного магазина обычно не открывается — это ограничение формата, а не наша жадность.',
  },
  {
    id: 'beta-faq-phone',
    question: 'Это работает с телефона?',
    answer:
      'Всё в браузере: на телефоне перевод слова выезжает снизу, страницы листаются свайпом, а на Android сайт можно добавить на главный экран. Нативных приложений в сторах нет и в бете не будет — мы не делаем вид, что иначе.',
  },
  {
    id: 'beta-faq-time',
    question: 'Сколько времени в день это займёт?',
    answer:
      'Глава — 15–20 минут вместе с кликами по словам. Порог в плохой день: две минуты на карточки повторения, чтобы не потерять очередь. Ритм вы выбираете сами при регистрации, от него и считается стрик.',
  },
  {
    id: 'beta-faq-after',
    question: 'Что будет после беты и сколько это станет стоить?',
    answer:
      'Не знаем и не обещаем: условия после беты решаются по её итогам. Станет известно — напишем всем зарегистрированным в тот же день. Словарь и прогресс при этом остаются вашими данными, они никуда не денутся.',
  },
];

/**
 * Чего на странице быть не может, потому что этого нет в продукте.
 * Список читает `beta.test.mjs`: он проходит по тексту /beta и по ответам FAQ.
 * Формулировки — подстроки, поэтому «скидк» ловит и «скидку», и «скидками».
 */
export const FORBIDDEN_PROMISES: string[] = [
  'промокод',
  'скидк',
  'навсегда бесплатно',
  'пожизненно',
  'дашборд учителя',
  'трекер группы',
  'мобильное приложение',
  'транскрипц',
  'озвучка всех книг',
];

/** фейковый счётчик остатка мест: «осталось 12 мест», «осталось 3 места» … */
export const FAKE_SEATS_LEFT = /остал[оа]сь\s+\d+\s+(мест|места|местов)/i;
