/**
 * Раскладка словаря по интервалам повторения — те же границы, что на сервере
 * (`SrsBreakdownService.BucketOf`). Дублирование намеренное: карточка на
 * /progress должна пережить, если агрегат ещё не построен, а тесты функций
 * гоняются без .NET. Расхождение ловит тест «бакеты совпадают с SRS-формулой».
 *
 * Почему границы такие — из формулы SM-2 в `SrsService.CalculateNextReview`:
 * первый успешный ответ даёт 1 день, второй — 6, дальше интервал × easeFactor.
 * Значит «learning» — это только слово, у которого дня ещё нет (срыв отправил
 * его на 10-минутный шаг), а не «меньше 7 дней»: так человек видит, что после
 * первого ответа слово уже вышло из обучения.
 */

export const SRS_BUCKET_IDS = ['learning', 'short', 'medium', 'long'] as const;

export type SrsBucketId = (typeof SRS_BUCKET_IDS)[number];

export interface SrsBucket {
  id: SrsBucketId;
  label: string;
  /** Что означает бакет — подпись под полосой, а не только диапазон. */
  caption: string;
}

export const SRS_BUCKETS: readonly SrsBucket[] = [
  { id: 'learning', label: '< 1 дня', caption: 'учу' },
  { id: 'short', label: '1–7 дней', caption: 'первые повторения' },
  { id: 'medium', label: '8–30 дней', caption: 'держатся' },
  { id: 'long', label: '> 30 дней', caption: 'почти выучены' },
];

/** Лееч — не бакет интервала, а отдельный счётчик: слово с 4+ срывами. */
export const LEECH_THRESHOLD = 4;

/**
 * Порог «знаю надёжно». Минимальный easeFactor — 1.3, поэтому интервал
 * больше 21 дня требует семи успешных ответов подряд (1 → 6 → 8 → 10 → 13 →
 * 17 → 23): слово остаётся в памяти, даже если не повторять три недели.
 */
export const RELIABLE_INTERVAL_DAYS = 21;

export type SrsDistribution = Record<SrsBucketId, number>;

export interface SrsCounts {
  totalWords?: number | null;
  learning?: number | null;
  short?: number | null;
  medium?: number | null;
  long?: number | null;
  leech?: number | null;
  reliableCount?: number | null;
}

/**
 * Бакет по интервалу в днях. Отрицательные и дробные значения не создаются
 * сервисом, но округляем вниз: 7.9 дня — это ещё «1–7».
 */
export function bucketOf(intervalDays: number): SrsBucketId {
  const days = Number.isFinite(intervalDays) ? Math.floor(intervalDays) : 0;
  if (days < 1) return 'learning';
  if (days <= 7) return 'short';
  if (days <= 30) return 'medium';
  return 'long';
}

const toCount = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * Распределение по счётчикам ответа API. На вход идёт уже посчитанный сервером
 * агрегат; лееч сюда не входит — он пересекается с бакетами интервала.
 */
export function distribution(counts: SrsCounts | null | undefined): SrsDistribution {
  const result: SrsDistribution = { learning: 0, short: 0, medium: 0, long: 0 };
  if (!counts) return result;

  const learning = toCount(counts.learning);
  const short = toCount(counts.short);
  const medium = toCount(counts.medium);
  let long = toCount(counts.long);

  // Сумма бакетов обязана сходиться с totalWords. Если сервер отдал только
  // totalWords (или бакеты разъехались), недостача идёт в «long»: проценты
  // не должны показывать «меньше 100» из-за арифметики в UI.
  const total = toCount(counts.totalWords);
  const known = learning + short + medium + long;
  if (total > known) long += total - known;

  return { learning, short, medium, long };
}

export function totalOf(dist: SrsDistribution): number {
  return SRS_BUCKET_IDS.reduce((sum, id) => sum + dist[id], 0);
}

/** Процент бакета от общего числа, с точностью до целого. Ноль слов — 0%, не NaN. */
export function percent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

/** «Знаю надёжно»: сервер считает сам, но без него — по длинным интервалам. */
export function reliableCount(counts: SrsCounts | null | undefined): number {
  if (!counts) return 0;
  if (counts.reliableCount != null) return toCount(counts.reliableCount);
  return toCount(counts.long);
}

/**
 * Русская плюрализация нужных здесь существительных. Отдельная копия,
 * потому что `plural()` в `@/lib/plural` — TS, а тесты функций идут в Node
 * без сборки; поведение сверяется тестом с исходной функцией.
 */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.floor(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function wordsLabel(n: number): string {
  return `${n} ${pluralRu(n, ['слово', 'слова', 'слов'])}`;
}

/** Следующий показ в человеческом виде для строки «почему это слово сегодня». */
export function formatNextInterval(intervalDays: number, intervalMinutes = 0): string {
  if (intervalMinutes > 0) {
    return `через ${intervalMinutes} ${pluralRu(intervalMinutes, ['минуту', 'минуты', 'минут'])}`;
  }
  const days = Math.floor(Number.isFinite(intervalDays) ? intervalDays : 0);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}`;
}
