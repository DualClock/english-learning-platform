'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect } from 'react';
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

const inputCls =
  'w-full px-4 py-3 rounded-lg border border-[var(--color-hairline-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent';

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();

  const { data: profileData, isLoading: isProfileLoading } = useApiQuery<Profile>('/api/profile', {
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
      setProfileToast('Профиль сохранён');
      setTimeout(() => setProfileToast(''), 3000);
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

  const changePassword = async (e: React.FormEvent<HTMLFormElement>) => {    e.preventDefault();
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

  if (
    status === 'loading' ||
    (status === 'authenticated' &&
      isProfileLoading &&
      profileData === undefined &&
      Boolean(session?.accessToken))
  ) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-[var(--color-hairline-strong)] border-t-[var(--color-primary)] rounded-full animate-spin"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-[var(--color-ink)] mb-8">Настройки</h1>

        {/* Профиль */}
        <section className="card p-6 mb-6">
          <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-5">Профиль</h2>

          <div className="space-y-5">
            {/* Аватар */}
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveAvatarSrc(avatarUrl)}
                alt="Текущий аватар"
                className="w-16 h-16 rounded-full object-cover shrink-0"
              />
              <div>
                <p className="font-medium text-[var(--color-ink)]">
                  {displayName || session?.user?.email}
                </p>
                <button
                  type="button"
                  onClick={() => setIsEditingAvatar((v) => !v)}
                  aria-expanded={isEditingAvatar}
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                >
                  {isEditingAvatar ? 'Скрыть выбор' : 'Сменить'}
                </button>
              </div>
            </div>

            {isEditingAvatar && (
              <div className="p-4 rounded-lg border border-[var(--color-hairline-strong)] bg-[var(--color-surface)]">
                <AvatarPicker
                  token={session?.accessToken || ''}
                  onDone={async (url) => {
                    setAvatarUrl(url);
                    setIsEditingAvatar(false);
                    setProfileToast('Аватар обновлён');
                    setTimeout(() => setProfileToast(''), 3000);
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
              <label htmlFor="setting-name" className="block text-sm font-medium text-[var(--color-ink)] mb-2">Имя</label>
              <input id="setting-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Как к вам обращаться"
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">Уровень</label>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() => setCefrLevel(cefrLevel === level ? '' : level)}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                      cefrLevel === level
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white'
                        : 'bg-white border-[var(--color-hairline-strong)] text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                    }`}
                  >
                    {LEVEL_LABELS[level]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--color-slate)] mt-2">
                Нажмите ещё раз, чтобы снять выбор («уровень не определён»)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">
                Норма дня, минут
              </label>
              <div className="inline-flex rounded-xl border border-[var(--color-hairline-strong)] overflow-hidden">
                {[10, 20, 30].map((n) => (
                  <button
                    key={n}
                    onClick={() => setDailyGoalMinutes(n)}
                    aria-pressed={dailyGoalMinutes === n}
                    className={`px-5 py-2 text-sm font-semibold transition-colors ${
                      dailyGoalMinutes === n
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-white text-[var(--color-slate)] hover:bg-[var(--color-surface)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">
                Новых слов в повторении за день
              </label>
              <div className="inline-flex rounded-xl border border-[var(--color-hairline-strong)] overflow-hidden">
                {[0, 5, 10, 20, 30].map((n) => (
                  <button
                    key={n}
                    onClick={() => setDailyNewWords(n)}
                    aria-pressed={dailyNewWords === n}
                    className={`px-4 py-2 text-sm font-semibold transition-colors ${
                      dailyNewWords === n
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'bg-white text-[var(--color-slate)] hover:bg-[var(--color-surface)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--color-slate)] mt-2">
                0 — повторять только то, что уже учите. Новые слова попадают в очередь в порядке добавления.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">
                Напоминания
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyEnabled}
                  onChange={(e) => setNotifyEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--color-hairline-strong)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                />
                <span className="text-sm text-[var(--color-slate)]">Напоминать о занятиях</span>
              </label>

              {notifyEnabled && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-[var(--color-slate)]">Удобное время</span>
                  <select
                    value={reminderHour}
                    onChange={(e) => setReminderHour(Number(e.target.value))}
                    className="px-3 py-2 rounded-lg border border-[var(--color-hairline-strong)] text-sm bg-white"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-xs text-[var(--color-slate)] mt-2">
                Выбор сохраняется в профиле. Часовой пояс определяется автоматически — по нему считается день в стрике.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={testReminder}
                  disabled={isTestingReminder}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  {isTestingReminder ? 'Проверяем…' : 'Проверить напоминание'}
                </button>
                {reminderTestResult && (
                  <span className="text-xs text-[var(--color-slate)]" role="status">
                    {reminderTestResult}
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--color-ink)] mb-2">Email</label>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-[var(--color-slate)] break-all">
                  {profileData?.email}
                </span>
                {profileData?.emailConfirmed ? (
                  <span className="text-xs px-2 py-1 rounded-md bg-[rgba(14,124,123,0.10)] text-[var(--color-primary)]">
                    подтверждён
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 rounded-md bg-[rgba(249,231,159,0.40)] text-[var(--color-ink)]">
                    не подтверждён
                  </span>
                )}
              </div>

              {profileData && !profileData.emailConfirmed && (
                <>
                  <p className="text-xs text-[var(--color-slate)] mt-2">
                    Подтвердите адрес — иначе не сможем прислать напоминания и восстановить пароль.
                    Ссылка приходит письмом при регистрации.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={resendConfirmation}
                      disabled={isResendingConfirmation}
                      className="btn-secondary text-sm disabled:opacity-50"
                    >
                      {isResendingConfirmation ? 'Отправляем…' : 'Отправить письмо ещё раз'}
                    </button>
                    {confirmationResult && (
                      <span className="text-xs text-[var(--color-slate)]" role="status">
                        {confirmationResult}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {profileToast && (
              <div className="p-3 rounded-lg bg-[rgba(14,124,123,0.10)] border border-[var(--color-primary)] text-[var(--color-primary)] text-sm">
                {profileToast}
              </div>
            )}
            {profileError && (
              <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm">
                {profileError}
              </div>
            )}

            <button
              onClick={saveProfile}
              disabled={isSavingProfile}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSavingProfile ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </section>

        {/* Смена пароля */}
        <section className="card p-6 mb-6">
          <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-5">Смена пароля</h2>

          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <label htmlFor="setting-current-password" className="block text-sm font-medium text-[var(--color-ink)] mb-2">Текущий пароль</label>
              <input id="setting-current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="setting-new-password" className="block text-sm font-medium text-[var(--color-ink)] mb-2">Новый пароль</label>
              <input id="setting-new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="setting-repeat-password" className="block text-sm font-medium text-[var(--color-ink)] mb-2">Повторите новый пароль</label>
              <input id="setting-repeat-password"
                type="password"
                value={repeatPassword}
                onChange={(e) => setRepeatPassword(e.target.value)}
                autoComplete="new-password"
                required
                className={inputCls}
              />
            </div>

            {passwordSuccess && (
              <div className="p-3 rounded-lg bg-[rgba(14,124,123,0.10)] border border-[var(--color-primary)] text-[var(--color-primary)] text-sm">
                ✓ {passwordSuccess}
              </div>
            )}
            {passwordErrors.length > 0 && (
              <div className="p-3 rounded-lg bg-[rgba(217,45,32,0.10)] border border-[var(--color-error)] text-[var(--color-error)] text-sm space-y-1">
                {passwordErrors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={isChangingPassword}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChangingPassword ? 'Меняем…' : 'Сменить пароль'}
            </button>
          </form>
        </section>

        {/* Аккаунт */}
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-[var(--color-ink)] mb-5">Аккаунт</h2>

          <div className="mb-5">
            <label htmlFor="setting-email" className="block text-sm font-medium text-[var(--color-ink)] mb-2">Email</label>
            <input id="setting-email"
              type="email"
              value={session?.user?.email || ''}
              readOnly
              className={`${inputCls} bg-[var(--color-surface)] text-[var(--color-slate)] cursor-not-allowed`}
            />
          </div>

          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg border border-[var(--color-error)] text-[var(--color-error)] font-medium hover:bg-[var(--color-error)] hover:text-white transition-colors"
          >
            Выйти
          </button>
        </section>
      </div>
    </AppLayout>
  );
}
