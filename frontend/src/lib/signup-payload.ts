import type { RawAttributionParams } from './attribution';

/**
 * Тело POST /api/auth/register (W1.4.4).
 *
 * Имена ключей здесь — зеркало серверного `RegisterDto`
 * (EnglishLearningPlatform.API/Controllers/AuthController.cs): MVC связывает
 * JSON без учёта регистра, поэтому опечатка в имени не даёт ошибку — поле
 * молча перестаёт доезжать. Ровно так и жил серверный honeypot: бэкенд ждал
 * `Website`, а форма его никогда не рендерила.
 */
export const HONEYPOT_FIELD_NAME = 'website';

export interface RegistrationFormInput {
  email: string;
  password: string;
  name: string;
  level: string;
  goals: string[];
  /** Цель по времени в минутах; undefined — если шаг не пройден */
  minutes?: number;
  notifications: boolean;
  /** IANA-зона браузера; undefined — если определить не удалось */
  timezone?: string;
  /** Honeypot: для живого человека всегда '' */
  website: string;
}

export interface RegistrationPayload {
  email: string;
  password: string;
  displayName?: string;
  cefrLevel?: string;
  studyGoal?: string;
  dailyGoalMinutes?: number;
  timeZoneId?: string;
  notifyEnabled: boolean;
  website: string;
  ref?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmContent?: string | null;
}

/**
 * Пустые необязательные поля отдаём undefined, а не '' — сервер различает
 * «не пришло» и «пришло пустым». Honeypot не входит в это правило: он обязан
 * быть в теле всегда, иначе защита превращается в декорацию.
 *
 * Атрибуция приходит из `registrationPayload()` (src/lib/attribution.ts) —
 * только непустые utm-метки и `ref`, ровно те ключи, которые есть в RegisterDto.
 */
export function buildRegistrationPayload(
  input: RegistrationFormInput,
  attribution: Partial<RawAttributionParams> | null
): RegistrationPayload {
  const goals = input.goals ?? [];

  return {
    email: input.email,
    password: input.password,
    displayName: input.name || undefined,
    cefrLevel: input.level || undefined,
    studyGoal: goals.length > 0 ? goals.join(',') : undefined,
    dailyGoalMinutes: input.minutes,
    timeZoneId: input.timezone || undefined,
    notifyEnabled: input.notifications,
    [HONEYPOT_FIELD_NAME]: input.website ?? '',
    ...(attribution ?? {}),
  };
}

/**
 * Реквизиты самого поля. Спрятано смещением и clipping-ом, а не display:none:
 * первое не видно глазу, второе выкинуло бы из доступности и настоящую форму.
 */
export const HONEYPOT_WRAPPER_STYLE = {
  position: 'absolute',
  left: '-10000px',
  top: 0,
  width: '1px',
  height: '1px',
  overflow: 'hidden',
} as const;

export interface HoneypotInputProps {
  type: 'text';
  name: string;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  autoComplete: 'off';
  tabIndex: number;
  'aria-hidden': true;
}

export function honeypotInputProps(
  value: string,
  onChange: (event: { target: { value: string } }) => void
): HoneypotInputProps {
  return {
    type: 'text',
    name: HONEYPOT_FIELD_NAME,
    value,
    onChange,
    autoComplete: 'off',
    tabIndex: -1,
    'aria-hidden': true,
  };
}

/** Часовой пояс браузера: undefined, если Intl не дал значение (приватный режим). */
export function detectTimeZoneId(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
