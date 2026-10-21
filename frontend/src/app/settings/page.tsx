'use client';

import AppLayout from '@/components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { Tag } from '@/components/ui/Badge';
import { useTheme } from '@/components/ThemeProvider';
import { THEME_MODES } from '@/lib/theme';
import { CheckIcon } from '@/components/ui/icons';
import Notice from '@/components/ui/Notice';
import { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ApiError, apiMutate, invalidateCache } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import { resolveAvatarSrc } from '@/app/lib/avatars';
import AvatarPicker from '@/components/AvatarPicker';

interface Profile {
  email: string;
  emailConfirmed?: boolean;
  displayName: string;
  avatarUrl: string | null;
  cefrLevel: string | null;
  studyGoal: string | null;
  dailyGoalMinutes: number;
  dailyNewWords?: number;
  notifyEnabled?: boolean;
  reminderHour?: number;
  timeZoneId?: string | null;
}

const LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1'];
const LEVEL_LABELS: Record<string, string> = {
  a1: 'A1',
  a2: 'A2',
  b1: 'B1',
  b2: 'B2',
  c1: 'C1',
};

const labelCls = 'mb-2 block text-body-sm font-medium text-ink';
const hintCls = 'mt-2 max-w-measure text-caption text-slate';

/** Группа кнопок-переключателей: один выбор из нескольких. */
function ChoiceRow<T extends string | number>({
  id,
  label,
  options,
  value,
  onChange,
  format,
  hint,
}: {
  id: string;
  label: string;
  options: T[];
  value: T;
  onChange: (next: T) => void;
  format?: (option: T) => string;
  hint?: string;
}) {
  return (
    <div>
      <span id={id} className={labelCls}>
        {label}
      </span>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={value === option ? 'pill-tab-active' : 'pill-tab'}
          >
            {format ? format(option) : String(option)}
          </button>
        ))}
      </div>
      {hint && <p className={hintCls}>{hint}</p>}
    </div>
  );
}

/**
 * Тема живёт в localStorage этого браузера, а не в профиле: устройство может
 * быть общим, а оформление — личным.
 */
function ThemePicker() {
  const { mode, setMode } = useTheme();
  return (
    <div>
      {/* Заголовок секции и есть подпись группы — дублировать его видимым лейблом не нужно. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Тема">
        {THEME_MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => setMode(option.value)}
            className={mode === option.value ? 'pill-tab-active' : 'pill-tab'}
          >
            {mode === option.value && <CheckIcon size={16} />}
            {option.label}
          </button>
        ))}
      </div>
      <p className={hintCls}>Применяется сразу и сохраняется в этом браузере.</p>
    </div>
  );
}

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();

  const {
    data: profileData,
    error: profileLoadError,
    isLoading: isProfileLoading,
    refresh: reloadProfile,
  } = useApiQuery<Profile>('/api/profile', {
    enabled: status === 'authenticated',
  });

  const [displayName, setDisplayName] = useState('');
  const [cefrLevel, setCefrLevel] = useState<string>('');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(10);
  const [dailyNewWords, setDailyNewWords] = useState(10);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(9);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileToast, setProfileToast] = useState('');
  const [profileError, setProfileError] = useState('');
  const [isTestingReminder, setIsTestingReminder] = useState(false);
  const [reminderTestResult, setReminderTestResult] = useState('');
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  // Заполняем форму, когда профиль пришёл из кэша или с сервера.
  useEffect(() => {
    if (!profileData) return;
    setDisplayName(profileData.displayName || '');
    setCefrLevel(profileData.cefrLevel || '');
    setDailyGoalMinutes(profileData.dailyGoalMinutes || 10);
    setDailyNewWords(profileData.dailyNewWords ?? 10);
    setNotifyEnabled(profileData.notifyEnabled ?? false);
    setReminderHour(profileData.reminderHour ?? 9);
    setAvatarUrl(profileData.avatarUrl ?? null);
  }, [profileData]);

  // Уровень из профиля сравниваем без регистра: чипы хранят ключи строчными
  const activeLevel = (cefrLevel || '').toLowerCase();

  // Уведомление живёт дольше, чем одно нажатие: таймер снимаем при размонтировании
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifySaved = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setProfileToast(text);
    toastTimer.current = setTimeout(() => setProfileToast(''), 3000);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const saveProfile = async () => {
    setIsSavingProfile(true);
    setProfileToast('');
    setProfileError('');
    try {
      await apiMutate('/api/profile', {
        token: session?.accessToken,
        method: 'PUT',
        body: {
          displayName,
          cefrLevel: cefrLevel || null,
          dailyGoalMinutes,
          dailyNewWords,
          notifyEnabled,
          reminderHour,
          // Часовой пояс нужен для корректного «дня» в стрике и расписании
          timeZoneId: (() => {
            try {
              return Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch {
              return null;
            }
          })(),
        },
        // Сбрасываем кэш профиля, чтобы dashboard/books/translator
        // при следующем заходе увидели новые данные.
        invalidate: ['/api/profile'],
      });
      notifySaved('Профиль сохранён');
    } catch {
      setProfileError('Не удалось сохранить профиль. Попробуйте ещё раз.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const testReminder = async () => {
    setIsTestingReminder(true);
    setReminderTestResult('');
    try {
      const result = await apiMutate<{ message: string; transport: string; delivered: boolean }>(
        '/api/notifications/test',
        { token: session?.accessToken, method: 'POST' }
      );
      setReminderTestResult(result?.message ?? 'Готово');
    } catch {
      setReminderTestResult('Не удалось проверить напоминание');
    } finally {
      setIsTestingReminder(false);
    }
  };

  // Повторное письмо-подтверждение: полезно, если первое не дошло или потерялось
  const resendConfirmation = async () => {
    setIsResendingConfirmation(true);
    setConfirmationResult('');
    try {
      const result = await apiMutate<{ message: string }>('/api/auth/resend-confirmation', {
        token: session?.accessToken,
        method: 'POST',
      });
      setConfirmationResult(result?.message ?? 'Письмо отправлено');
    } catch (err) {
      setConfirmationResult(
        err instanceof ApiError ? err.message : 'Не удалось отправить письмо. Попробуйте позже.'
      );
    } finally {
      setIsResendingConfirmation(false);
    }
  };

  const changePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPasswordSuccess('');
    setPasswordErrors([]);

    if (newPassword !== repeatPassword) {
      setPasswordErrors(['Новый пароль и его повтор не совпадают']);
      return;
    }

    setIsChangingPassword(true);
    try {
      await apiMutate('/api/profile/change-password', {
        token: session?.accessToken,
        method: 'POST',
        body: { currentPassword, newPassword },
      });

      setPasswordSuccess('Пароль изменён');
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
    } catch (err) {
      if (err instanceof ApiError) {
        setPasswordErrors([
          err.message && !err.message.startsWith('Ошибка запроса')
            ? err.message
            : 'Не удалось сменить пароль',
        ]);
      } else {
        setPasswordErrors(['Сервер недоступен. Попробуйте позже.']);
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push('/login');
  };

  // Данные профиля не пришли вообще — форма была бы пустой и обманчивой
  if (profileLoadError && profileData === undefined) {
    return (
      <AppLayout>
        <PageHeader title="Настройки" />
        <ErrorState
          title="Настройки не загрузились"
          description={profileLoadError}
          onRetry={reloadProfile}
        />
      </AppLayout>
    );
  }

  if (
    status === 'loading' ||
    (status === 'authenticated' &&
      isProfileLoading &&
      profileData === undefined &&
      Boolean(session?.accessToken))
  ) {
    return (
      <AppLayout>
        <PageHeader title="Настройки" />
        <div className="mx-auto max-w-2xl">
          <LoadingState rows={4} label="Загрузка настроек" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader title="Настройки" subtitle="Профиль, норма дня и напоминания" />

      <div className="mx-auto max-w-2xl space-y-6">
        {/* Профиль */}
        <section className="card">
          <h2 className="mb-5 text-h3 text-ink">Профиль</h2>

          <div className="space-y-5">
            {/* Аватар */}
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveAvatarSrc(avatarUrl)}
                alt="Текущий аватар"
                className="h-16 w-16 shrink-0 rounded-full object-cover"
              />
              <div>
                <p className="text-body-sm font-medium text-ink">
                  {displayName || session?.user?.email}
                </p>
                <button
                  type="button"
                  onClick={() => setIsEditingAvatar((v) => !v)}
                  aria-expanded={isEditingAvatar}
                  className="text-body-sm font-medium text-primary hover:underline"
                >
                  {isEditingAvatar ? 'Скрыть выбор' : 'Сменить'}
                </button>
              </div>
            </div>

            {isEditingAvatar && (
              <div className="rounded-lg border border-hairline-strong bg-surface p-4">
                <AvatarPicker
                  token={session?.accessToken || ''}
                  current={avatarUrl}
                  onDone={async (url) => {
                    setAvatarUrl(url);
                    setIsEditingAvatar(false);
                    notifySaved('Аватар обновлён');
                    // AvatarPicker сохраняет аватар сам, но кэш профиля
                    // нужно сбросить, чтобы остальные вкладки увидели новый аватар.
                    invalidateCache('/api/profile');
                    try {
                      await update({ avatarUrl: url });
                    } catch {
                      // сессия подтянется при следующем входе
                    }
                  }}
                />
              </div>
            )}

            <div>
              <label htmlFor="setting-name" className={labelCls}>
                Имя
              </label>
              <input
                id="setting-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Как к вам обращаться"
                className="input"
              />
            </div>

            {/* Профиль может вернуть «B1», а ключи чипов строчные */}
            <ChoiceRow
              id="setting-level"
              label="Уровень"
              options={LEVELS}
              value={activeLevel}
              onChange={(level) => setCefrLevel(activeLevel === level ? '' : level)}
              format={(level) => LEVEL_LABELS[level]}
              hint="Нажмите ещё раз, чтобы снять выбор («уровень не определён»)"
            />

            <ChoiceRow
              id="setting-minutes"
              label="Норма дня, минут"
              options={[10, 20, 30]}
              value={dailyGoalMinutes}
              onChange={setDailyGoalMinutes}
            />

            <ChoiceRow
              id="setting-new-words"
              label="Новых слов в повторении за день"
              options={[0, 5, 10, 20, 30]}
              value={dailyNewWords}
              onChange={setDailyNewWords}
              hint="0 — повторять только то, что уже учите. Новые слова попадают в очередь в порядке добавления."
            />

            <div>
              <span id="setting-reminders" className={labelCls}>
                Напоминания
              </span>
              <label className="flex cursor-pointer items-center gap-3" htmlFor="setting-notify">
                <input
                  id="setting-notify"
                  type="checkbox"
                  checked={notifyEnabled}
                  onChange={(e) => setNotifyEnabled(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-body-sm text-slate">Напоминать о занятиях</span>
              </label>

              {notifyEnabled && (
                <div className="mt-3 flex items-center gap-2">
                  <label htmlFor="setting-hour" className="text-body-sm text-slate">
                    Удобное время
                  </label>
                  <select
                    id="setting-hour"
                    value={reminderHour}
                    onChange={(e) => setReminderHour(Number(e.target.value))}
                    className="input h-10 w-auto"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className={hintCls}>
                Выбор сохраняется в профиле. Часовой пояс определяется автоматически — по нему
                считается день в стрике.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={testReminder} disabled={isTestingReminder}>
                  {isTestingReminder ? 'Проверяем…' : 'Проверить напоминание'}
                </Button>
                {/* Живая область смонтирована заранее: иначе сообщение не озвучится */}
                <p role="status" aria-live="polite" className="text-caption text-slate">
                  {reminderTestResult}
                </p>
              </div>
            </div>

            <div>
              <span className={labelCls}>Email</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-body-sm text-slate break-all">{profileData?.email}</span>
                {profileData?.emailConfirmed ? (
                  <Tag tone="success">
                    <CheckIcon size={16} className="mr-1" />
                    подтверждён
                  </Tag>
                ) : (
                  <Tag tone="warning">не подтверждён</Tag>
                )}
              </div>

              {profileData && !profileData.emailConfirmed && (
                <>
                  <p className={hintCls}>
                    Подтвердите адрес — иначе не сможем прислать напоминания и восстановить пароль.
                    Ссылка приходит письмом при регистрации.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      variant="secondary"
                      onClick={resendConfirmation}
                      disabled={isResendingConfirmation}
                    >
                      {isResendingConfirmation ? 'Отправляем…' : 'Отправить письмо ещё раз'}
                    </Button>
                    <p role="status" aria-live="polite" className="text-caption text-slate">
                      {confirmationResult}
                    </p>
                  </div>
                </>
              )}
            </div>

            {profileToast && <Notice>{profileToast}</Notice>}
            {profileError && <Notice tone="danger">{profileError}</Notice>}

            <Button onClick={saveProfile} disabled={isSavingProfile}>
              {isSavingProfile ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </section>

        {/* Оформление */}
        <section className="card">
          <h2 className="mb-5 text-h3 text-ink">Оформление</h2>
          <ThemePicker />
        </section>

        {/* Смена пароля */}
        <section className="card">
          <h2 className="mb-5 text-h3 text-ink">Смена пароля</h2>

          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <label htmlFor="setting-current-password" className={labelCls}>
                Текущий пароль
              </label>
              <input
                id="setting-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="input"
              />
            </div>

            <div>
              <label htmlFor="setting-new-password" className={labelCls}>
                Новый пароль
              </label>
              <input
                id="setting-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="input"
              />
            </div>

            <div>
              <label htmlFor="setting-repeat-password" className={labelCls}>
                Повторите новый пароль
              </label>
              <input
                id="setting-repeat-password"
                type="password"
                value={repeatPassword}
                onChange={(e) => setRepeatPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="input"
              />
            </div>

            {passwordSuccess && <Notice>{passwordSuccess}</Notice>}
            {passwordErrors.length > 0 && (
              <Notice tone="danger">
                {passwordErrors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </Notice>
            )}

            <Button type="submit" disabled={isChangingPassword}>
              {isChangingPassword ? 'Меняем…' : 'Сменить пароль'}
            </Button>
          </form>
        </section>

        {/* Аккаунт */}
        <section className="card">
          <h2 className="mb-5 text-h3 text-ink">Аккаунт</h2>

          <div className="mb-5">
            <label htmlFor="setting-email" className={labelCls}>
              Email
            </label>
            <input
              id="setting-email"
              type="email"
              value={session?.user?.email || ''}
              readOnly
              aria-readonly="true"
              className="input bg-surface text-slate"
            />
          </div>

          <Button variant="danger" onClick={handleLogout}>
            Выйти
          </Button>
        </section>
      </div>
    </AppLayout>
  );
}
