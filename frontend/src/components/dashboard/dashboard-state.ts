/*
 * Состояния виджетов дашборда.
 *
 * Зачем отдельный модуль. На дашборде шесть независимых запросов, и раньше
 * ошибка любого из них молча превращалась в ноль: `reviewToday?.totalCount ?? 0`
 * давал «Всё повторено» и человеку с пустым словарём, и человеку, у которого
 * упал бэкенд. `StreakCard` при `streak === null` показывал скелетон вечно,
 * потому что ветка `if (!streak)` не различала «ещё грузится» и «не пришло».
 *
 * Правило, которое теперь одно на всё: у каждого виджета ровно четыре
 * состояния, и «нет данных» никогда не рисуется как ноль.
 */

export type WidgetState = 'loading' | 'error' | 'empty' | 'ready';

export interface WidgetInput<T> {
  /** Значение из `useApiQuery`: `undefined`, пока ответа не было. */
  data: T | undefined;
  /** Сообщение ошибки от `useApiQuery`; `null`, если её нет. */
  error: string | null;
  /** Готов ли запрос вообще идти (для условных запросов вроде рекомендаций). */
  enabled?: boolean;
  /** Считать ли полученное значение «пустым». По умолчанию — только null/undefined. */
  isEmpty?: (data: T) => boolean;
}

/**
 * Состояние виджета. Порядок проверок важен:
 *  - ошибка важнее данных: сеть могла отдать кэш, а запрос — упасть;
 *  - данные важнее загрузки: если значения есть, показываем их без мигания;
 *  - выключенный запрос — не «ошибка» и не «пусто», а отдельное «ещё не начали».
 *
 * Тип обобщённый: предикат `isEmpty` типизирован данными конкретного виджета,
 * поэтому вызывающий код не кастует его руками.
 */
export function widgetState<T>(input: WidgetInput<T>): WidgetState {
  const { data, error, enabled = true, isEmpty } = input;
  if (!enabled) return 'loading';
  if (error) return 'error';
  if (data === undefined) return 'loading';
  if (isEmpty ? isEmpty(data) : data === null) return 'empty';
  return 'ready';
}

/**
 * Что показать вместо числа, когда его нет.
 *
 * Прочерк, а не ноль: ноль — это утверждение о данных («ты не повторил ни
 * одного слова»), а отсутствие ответа — не утверждение. Пользователь,
 * увидевший «0 слов в словаре» при упавшем API, сделает вывод о себе, а не
 * о сервисе.
 */
export const MISSING_VALUE = '—';

/** Число для показа или прочерк. `null`/`undefined`/NaN/∞ — прочерк. */
export function displayCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : MISSING_VALUE;
}

/** Заголовок блока повторения по состоянию. */
export function reviewHeadline(state: WidgetState, count: number): string {
  switch (state) {
    case 'loading':
      return 'Проверяем повторения…';
    case 'error':
      return 'Не удалось загрузить повторения';
    case 'empty':
      return 'Повторять пока нечего';
    case 'ready':
      return count > 0 ? `Сегодня ждут повторения: ${count}` : 'Повторять пока нечего';
  }
}

/**
 * Подпись под заголовком повторения.
 *
 * Здесь важно не путать два разных «пусто»: у нового аккаунта слов ещё нет
 * («добавь первые слова — и повторение появится»), а у активного всё сделано
 * («на сегодня всё, возвращайся завтра»). Раньше оба случая получали одно
 * сообщение «Всё повторено», которое новичку читается как «здесь нечего делать».
 */
export function reviewDescription(state: WidgetState, count: number): string {
  switch (state) {
    case 'loading':
      return 'Считаем, сколько слов ждёт сегодня.';
    case 'error':
      return 'Это сбой связи, а не отсутствие слов. Попробуйте обновить.';
    case 'empty':
      return 'Добавьте первые слова в словарь — и они начнут возвращаться на повторение.';
    case 'ready':
      return count > 0
        ? 'Пара минут сейчас — и эти слова останутся с вами надолго.'
        : 'На сегодня всё сделано. Завтра слова вернутся по расписанию.';
  }
}

/**
 * Рисовать ли полосу серии (стрика) на дашборде.
 *
 * Полоса серии имеет смысл, когда есть что показывать. На ошибке или пока
 * данных нет — блок не рисуем: пустая рамка с бесконечным скелетоном хуже,
 * чем её отсутствие.
 */
export function shouldRenderStreak(state: WidgetState): boolean {
  return state === 'ready' || state === 'empty';
}

/**
 * Показывать ли блок лиги.
 *
 * Соревнование имеет смысл только когда в группе достаточно людей. На бете с
 * парой десятков аккаунтов лига всегда была «формируется», и это читалось как
 * «сервис пустой»: человек видел подтверждение, что здесь никого нет.
 */
export const MIN_COMPETITIVE_PARTICIPANTS = 10;

export function shouldRenderLeague(participantCount: number | null | undefined): boolean {
  return typeof participantCount === 'number' && participantCount >= MIN_COMPETITIVE_PARTICIPANTS;
}
