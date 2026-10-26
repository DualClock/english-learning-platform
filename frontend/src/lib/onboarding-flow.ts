/*
 * Чистая логика онбординга: что спрашиваем, в каком порядке и что уходит
 * на сервер. Вынесено из страницы, потому что это единственное место, где
 * раньше ломался вход в продукт (шесть полей и тест уровня до первого слова),
 * и потому что порядок шагов проще проверить тестом, чем глазами в JSX.
 */

/** Уровни CEFR, которые понимает бэкенд (`RegisterDto.Level`). */
export const CEFR_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/**
 * Шаги онбординга. Ровно два, и оба — про аккаунт:
 *  - `account` — email и пароль (имя необязательно);
 *  - `goal`    — зачем пришёл (можно пропустить).
 *
 * Теста уровня здесь больше нет: он есть на `/test` и на лендинге, и его
 * результат приходит параметром `?level=`. Раньше онбординг начинался с того
 * же теста заново, и человек второй раз отвечал на те же 16 вопросов.
 */
export type OnboardingStep = 'account' | 'goal';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['account', 'goal'];

export function stepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

export function totalSteps(): number {
  return ONBOARDING_STEPS.length;
}

/**
 * Уровень из адреса. Принимает `?level=b1`, `?level=B1`, `?level= b1 `.
 * Всё, что не входит в CEFR, — `null`: подставлять «a1 по умолчанию» значит
 * записать человеку в профиль неправду, а профиль влияет на рекомендации книг.
 */
export function levelFromQuery(raw: string | null | undefined): CefrLevel | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  return (CEFR_LEVELS as readonly string[]).includes(normalized) ? (normalized as CefrLevel) : null;
}

/**
 * Куда вести после успешной регистрации.
 *
 * Не на `/dashboard`: дашборд — это набор виджетов, два из которых у нового
 * аккаунта пустые («нет слов к повторению», «все юниты пройдены»), и человек
 * видит интерфейс, а не продукт. Правильный первый экран — библиотека с
 * подсказкой «добавь первую книгу»; `first=1` включает этот акцент.
 */
export const POST_SIGNUP_PATH = '/books?first=1';

/** Допустимо ли значение пароля. Правило то же, что в `RegisterDto`. */
export function isValidPassword(password: string): boolean {
  return password.trim().length >= 6;
}

/** Простая проверка адреса: полный RFC здесь не нужен, сервер проверит сам. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Достаточно ли данных для отправки формы.
 *
 * Имя больше не требуется: бэкенд выводит `DisplayName` из локальной части
 * e-mail (`ReminderService` в приветствии это уже умеет). Требовать имя —
 * значит просить строку, которую человек не обязан придумывать ради доступа.
 */
export function canSubmitAccount(fields: { email: string; password: string }): boolean {
  return isValidEmail(fields.email) && isValidPassword(fields.password);
}

/**
 * Подпись к чекбоксу напоминаний. Уведомления включены по умолчанию (и на
 * сервере `NotifyEnabled ?? true`), поэтому текст обещает ровно то, что будет:
 * одно письмо в день, отписка в настройках.
 */
export const NOTIFY_COPY = {
  label: 'Напомним о повторении раз в день',
  hint: 'Отписаться можно в настройках. В 9:00 по вашему часовому поясу.',
} as const;

/** Первое приветствие после регистрации — без списка «уровень + цели». */
export function welcomeHeadline(name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  return clean ? `Добро пожаловать, ${clean}!` : 'Добро пожаловать!';
}
