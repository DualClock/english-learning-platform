/*
 * Новости для личного блока на дашборде: типы ответа и чистые функции отбора.
 *
 * Почему логика живёт здесь, а не в компоненте. Сервер уже отдаёт «пять и по
 * интересам», но полагаться на это нельзя: фильтр по интересам пишется в
 * параллельной ветке, ответ может прийти неотфильтрованным (пока ручка
 * отдаёт всё), а скрытую новость (`IsHidden`) сервер-агрегатор может
 * выдать по ошибке. Проверка на клиенте стоит копейки и не зависит от того,
 * когда бэкенд доедет.
 */

import { normalizeInterests } from './interests.ts';

/** Уровень CEFR, в котором сервер публикует новость. */
export const NEWS_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type NewsLevel = (typeof NEWS_LEVELS)[number];

/*
 * Имена полей — как в БД, но в camelCase, как их отдаёт ASP.NET по умолчанию
 * (`JsonSerializer` с web-настройками). `BodyHtml` в карточке не нужен —
 * показываем `Summary`, а полный текст живёт на первоисточнике.
 */
export interface NewsItem {
  id: number;
  title: string;
  summary: string;
  /** Полный текст в HTML. Может отсутствовать в облегчённом ответе списка. */
  bodyHtml?: string | null;
  sourceName: string;
  sourceUrl: string;
  imageUrl?: string | null;
  level: NewsLevel | string;
  /**
   * Темы новости.
   *
   * В базе они лежат строкой через запятую (`NewsItem.Topics`), но API
   * отдаёт их МАССИВОМ — контроллер режет строку на выходе. Тип допускает
   * оба варианта, потому что вторая форма уже приходила и роняла дашборд:
   * `item.topics.split is not a function` в error boundary.
   */
  topics: string | readonly string[] | null;
  /** ISO-8601. Строка, а не Date: JSON приходит строкой, парсим на месте. */
  publishedAt: string;
  isHidden: boolean;
}

/**
 * Сколько карточек максимум. Пятёрка — не «красивое число»: блок стоит под
 * «Планом на сегодня» и не должен отодвигать остальной дашборд за первый
 * экран. Сервер отдаёт те же пять, здесь это лишь страховка.
 */
export const MAX_NEWS = 5;

/** JSON-readonly вариант: сервер может отдать и массив, и конверт `{ items }`. */
type NewsPayload = readonly NewsItem[] | { items?: readonly NewsItem[] } | null | undefined;

export function toNewsList(payload: NewsPayload): NewsItem[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return [...payload];
  const items = (payload as { items?: readonly NewsItem[] }).items;
  return items ? [...items] : [];
}

/** Нормализация уровня: `b1` → `B1`; всё, чего нет в CEFR, — `null`. */
export function normalizeNewsLevel(raw: unknown): NewsLevel | null {
  if (typeof raw !== 'string') return null;
  const level = raw.trim().toUpperCase();
  return (NEWS_LEVELS as readonly string[]).includes(level) ? (level as NewsLevel) : null;
}

/**
 * Годится ли новость для бейджа уровня. Невалидный уровень — единственный
 * случай, когда карточка не может нарисовать себя корректно: пустая плашка
 * уровня выглядит как ошибка вёрстки, поэтому такую новость не показываем.
 */
export function hasValidLevel(item: NewsItem): boolean {
  return normalizeNewsLevel(item.level) !== null;
}

/**
 * Темы новости из строки через запятую.
 *
 * Разделитель — запятая, но допускаем ещё `;` и `|`: загрузчик новостей
 * пишется параллельно, и «sport; tech» в базе не должно делать новость
 * невидимой для обеих тем.
 */
export function newsTopics(item: NewsItem): string[] {
  if (!item.topics) return [];

  // Две формы с сервера: массив (так отдаёт API) и строка через запятую
  // (так лежит в базе). Разбор обеих в одном месте — вызывающий код не
  // должен знать, откуда пришла новость.
  const raw = Array.isArray(item.topics) ? item.topics : [item.topics];

  return raw
    .flatMap((topic) => String(topic ?? '').split(/[,;|]/))
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Подходит ли новость человеку.
 *
 * Пустой набор интересов — «показывай всё». Это осознанно: интересы в
 * онбординге необязательны, и человек, который их пропустил, должен видеть
 * хоть что-то, а не пустой блок. Пустая строка `topics` — новость рубрики,
 * без тем; её показываем всем, иначе такие материалы не увидит никто.
 */
export function matchesInterests(item: NewsItem, interests: readonly string[]): boolean {
  const chosen = normalizeInterests(interests);
  if (chosen.length === 0) return true;
  const topics = newsTopics(item);
  if (topics.length === 0) return true;
  return topics.some((topic) => (chosen as readonly string[]).includes(topic));
}

/**
 * Итоговый список для блока: без скрытых, без битого уровня, только по
 * интересам, свежее — выше, и не больше пяти.
 *
 * Сортировка здесь, а не «как пришло»: если ручка когда-нибудь отдаст
 * смешанный ответ (кэш плюс свежий запрос), первыми должны стоять свежие,
 * а не те, что случайно легли раньше в массиве.
 *
 * Fallback на общий микс — вынужденная мера. Источник (News in Levels) не
 * размечает рубрики: у всех новостей тема «news». Человек, выбравший «Спорт»
 * и «Технологии», видел пустой блок при живых новостях — это выглядело как
 * поломка. Поэтому если по интересам не совпало ничего, показываем свежее
 * без фильтра.
 *
 * Персонализация при этом не размывается: как только хоть одна новость
 * совпала по теме, показываем ТОЛЬКО совпавшие. Fallback включается лишь
 * при полном промахе.
 */
export function selectNews(
  payload: NewsPayload,
  interests: readonly string[],
  options: { limit?: number } = {}
): NewsItem[] {
  const limit = options.limit ?? MAX_NEWS;
  const list = toNewsList(payload);

  // Общий допустимый набор: скрытые и битый уровень отсекаем всегда — это
  // не про интересы, а про то, что вообще можно показывать.
  const eligible: NewsItem[] = [];
  for (const item of list) {
    if (!item || item.isHidden) continue;
    if (!item.id || !item.title?.trim()) continue;
    if (!hasValidLevel(item)) continue;
    eligible.push(item);
  }

  const matched = eligible.filter((item) => matchesInterests(item, interests));

  // Пустой набор интересов даёт совпадение со всем, поэтому matched не пуст —
  // fallback здесь не сработает, и «не выбирал темы» останется отличным от
  // «выбрал, но не совпало».
  const chosen = matched.length > 0 ? matched : eligible;

  chosen.sort((left, right) => publishedTime(right) - publishedTime(left));

  const capped: NewsItem[] = [];
  for (const item of chosen) {
    if (capped.length >= limit) break;
    capped.push(item);
  }
  return capped;
}

/**
 * Время публикации в миллисекундах. Невалидная дата уходит в конец списка
 * (`-Infinity`), а не в начало: `NaN` в компараторе делает сортировку
 * непредсказуемой, и порядок карточек прыгал бы между рендерами.
 */
export function publishedTime(item: NewsItem): number {
  const time = Date.parse(item.publishedAt ?? '');
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/**
 * Рисуем ли блок вообще. Пусто — значит блока НЕТ, ни заголовка, ни
 * «пока ничего нет»: пустая карточка на дашборде читается как поломка,
 * а не как «завтра будет».
 */
export function shouldShowNews(items: readonly NewsItem[]): boolean {
  return items.length > 0;
}

/** Хост источника без `www.` — то, что помещается в строку «Источник · дата». */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Есть ли куда вести ссылку «к первоисточнику»: только http(s), не javascript:. */
export function isSafeSourceUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Дата по-русски: «5 октября», а для другого года — «5 октября 2025».
 *
 * `toLocaleDateString('ru-RU')` не используем: Node и браузер дают разный
 * формат (запятая, `г.`, узкие пробелы), и Next ругался на гидратацию.
 */
export function formatNewsDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  return date.getFullYear() === now.getFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${date.getFullYear()}`;
}

/**
 * URL ленты новостей для главной.
 *
 * Контракт с бэкендом: `GET /api/news/for-me?level=&take=`. Через прокси
 * `/api/next` этот путь идёт с подставленным Authorization — так сервер узнаёт
 * пользователя и берёт ЕГО интересы из профиля.
 *
 * Интересы в адрес НЕ передаются намеренно: доверять клиенту, который их
 * присылает, значило бы позволить любому запросить подборку по чужим темам.
 *
 * `level` — из профиля. Без него сервер отдаст смесь уровней, и человек на A1
 * получит текст, который не может прочитать.
 */
export function newsFeedPath(level?: string | null): string {
  const params = new URLSearchParams();
  params.set('take', String(MAX_NEWS));

  const normalized = typeof level === 'string' ? level.trim().toUpperCase() : '';
  if (NEWS_LEVELS.includes(normalized as NewsLevel)) {
    params.set('level', normalized);
  }

  return '/api/next/news/for-me?' + params.toString();
}
