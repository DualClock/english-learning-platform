/*
 * Справочник интересов к новостям и чистые функции поверх него.
 *
 * Ключ есть контракт с сервером (`UserInterest.Interest`), подпись — только
 * для человека. Держим оба в одном месте, потому что раньше в подобных
 * справочниках ключ и подпись расходились между экранами: онбординг писал
 * `sport`, а дашборд фильтровал по `sports` — и новости «не находились».
 *
 * Набор ключей совпадает с тем, что уже лежит в базе (таблица справочника
 * тем), поэтому добавление темы здесь без строки в БД — это новая тема,
 * фильтр по которой сервер просто проигнорирует.
 */

export const INTERESTS = [
  { key: 'news', label: 'Мировые события' },
  { key: 'sport', label: 'Спорт' },
  { key: 'science', label: 'Наука' },
  { key: 'tech', label: 'Технологии' },
  { key: 'business', label: 'Бизнес' },
  { key: 'culture', label: 'Культура' },
  { key: 'travel', label: 'Путешествия' },
  { key: 'health', label: 'Здоровье' },
  { key: 'nature', label: 'Природа' },
  { key: 'interesting', label: 'Интересное' },
] as const;

export type InterestKey = (typeof INTERESTS)[number]['key'];

export interface InterestOption {
  key: string;
  label: string;
}

const ALL_KEYS: readonly string[] = INTERESTS.map((item) => item.key);

/**
 * Есть ли шаг выбора интересов в онбординге намеренно необязательным?
 * Да, и поэтому за него отвечает этот флаг: сервер `UserInterest` не требует
 * ни строки, а пустой список означает «показывай всё» (см. `news.ts`).
 */
export const MAX_INTERESTS = INTERESTS.length;

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Известна ли тема. Неизвестный ключ — не ошибка ввода, а мусор из старой ссылки. */
export function isInterestKey(value: unknown): value is InterestKey {
  return typeof value === 'string' && ALL_KEYS.includes(normalize(value));
}

/** Подпись темы для интерфейса. Неизвестный ключ возвращается как есть. */
export function interestLabel(key: string): string {
  const found = INTERESTS.find((item) => item.key === normalize(key));
  return found ? found.label : key;
}

/**
 * Приведение списка тем к тому, что понимает сервер.
 *
 * Три свойства, каждое из которых ломается само по себе:
 *  - чужие ключи выкидываются (иначе сервер вернёт 400 на весь список);
 *  - повторы схлопываются (двойной клик по карточке не должен давать дубль);
 *  - порядок — как в справочнике, а не как нажимали: ответ API при повторной
 *    загрузке профиля не должен «перетасовывать» выбранные темы.
 */
export function normalizeInterests(raw: readonly unknown[] | null | undefined): InterestKey[] {
  if (!raw || raw.length === 0) return [];
  const chosen = new Set<string>();
  for (const value of raw) {
    if (!isInterestKey(value)) continue;
    chosen.add(normalize(value as string));
  }
  return INTERESTS.map((item) => item.key).filter((key) => chosen.has(key));
}

/** Переключатель для мультивыбора: добавляет или убирает тему, сохраняя порядок справочника. */
export function toggleInterest(current: readonly string[], key: string): InterestKey[] {
  if (!isInterestKey(key)) return normalizeInterests(current);
  const set = new Set(normalizeInterests(current));
  const normalized = normalize(key);
  if (set.has(normalized as InterestKey)) {
    set.delete(normalized as InterestKey);
  } else {
    set.add(normalized as InterestKey);
  }
  return INTERESTS.map((item) => item.key).filter((item) => set.has(item));
}

/**
 * Тело запроса `POST /api/next/interests`: `{"interests": ["sport","tech"]}`.
 *
 * Обычный цикл `for` вместо spread по сету: `node --test` гоняет файл
 * как отдельный модуль без transpiler-хелперов, а downlevel-итерация Set
 * зависит от настроек сборки. Массив здесь собирается явно и одинаково
 * в браузере и в тесте.
 */
export function interestsPayload(raw: readonly string[]): { interests: InterestKey[] } {
  const list = normalizeInterests(raw);
  const result: InterestKey[] = [];
  for (const key of list) result.push(key);
  return { interests: result };
}

/**
 * Что показать в кнопке продолжения. Пустой выбор — не повод блокировать
 * кнопку: интересы не обязательны, и человек вправе их не иметь.
 */
export function interestsButtonLabel(selected: readonly string[]): string {
  const count = normalizeInterests(selected).length;
  if (count === 0) return 'Пропустить';
  return count === 1 ? 'Выбрать 1 тему' : `Выбрать ${count} ${pluralTopics(count)}`;
}

/** Родительный падеж для «1 тема / 2 темы / 5 тем». */
function pluralTopics(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'тему';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'темы';
  return 'тем';
}

/**
 * Адрес сохранения интересов. Сегмент `api` в пути уже учтён прокси
 * (`app/api/next/[...path]` строит `${API_URL}/api/${path}`), поэтому второй
 * `/api` в аргументе дал бы `/api/api/...` и 404 — этот баг в проекте уже
 * ловили (см. `api-next-paths.test.mjs`).
 */
export const INTERESTS_PATH = '/api/next/interests';

export function interestSavePath(): string {
  return INTERESTS_PATH;
}

/** Список для экрана выбора: тот же справочник, но в форме карточек. */
export function interestOptions(): InterestOption[] {
  return INTERESTS.map((item) => ({ key: item.key, label: item.label }));
}
