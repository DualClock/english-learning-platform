'use client';

import Link from 'next/link';
import AppLayout from '@/components/AppLayout';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { Tag } from '@/components/ui/Badge';
import { useTheme } from '@/components/ThemeProvider';
import {
  ACCENT_THEMES,
  THEME_MODES,
  applyAccent,
  normalizeAccent,
  writeAccent,
  type AccentTheme,
} from '@/lib/theme';
import {
  AVATAR_FRAMES,
  frameLabel,
  frameUnlocked,
  normalizeFrame,
  type AvatarFrame,
} from '@/lib/customization';
import UserAvatar from '@/components/UserAvatar';
import { CheckIcon, LockIcon } from '@/components/ui/icons';
import Notice from '@/components/ui/Notice';
import { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ApiError, apiMutate, invalidateCache } from '@/app/lib/api-client';
import { useApiQuery } from '@/app/lib/use-api';
import AvatarPicker from '@/components/AvatarPicker';

interface Profile {
  email: string;
  emailConfirmed?: boolean;
  displayName: string;
  avatarUrl: string | null;
  avatarFrame?: string | null;
  accentTheme?: string | null;
  cefrLevel: string | null;
  studyGoal: string | null;
  dailyGoalMinutes: number;
  dailyNewWords?: number;
  notifyEnabled?: boolean;
  reminderHour?: number;
  timeZoneId?: string | null;
}

interface AchievementLite {
  code: string;
  unlocked: boolean;
}

interface ProgressLite {
  achievements: AchievementLite[];
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
  const { mode } = useTheme();
  const router = useRouter();

  const {
    data: profileData,
    error: profileLoadError,
    isLoading: isProfileLoading,
    refresh: reloadProfile,
  } = useApiQuery<Profile>('/api/profile', {
    enabled: status === 'authenticated',
  });

  const { data: progressData } = useApiQuery<ProgressLite>('/api/progress/achievements', {
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
  const [selectedFrame, setSelectedFrame] = useState<AvatarFrame>('none');
  const [savedFrame, setSavedFrame] = useState<AvatarFrame>('none');
  const [selectedAccent, setSelectedAccent] = useState<AccentTheme>('teal');
  const [savedAccent, setSavedAccent] = useState<AccentTheme>('teal');
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);
  const [customizationNotice, setCustomizationNotice] = useState('');
  const [customizationError, setCustomizationError] = useState('');

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

  // Удаление аккаунта: два подтверждения (ввод email + ввод пароля), потому
  // что запрос необратим и забирает ещё и загруженные файлы.
  const [isConfirmingDeletion, setIsConfirmingDeletion] = useState(false);
  const [deletionEmail, setDeletionEmail] = useState('');
  const [deletionPassword, setDeletionPassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletionError, setDeletionError] = useState('');

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
    const frame = normalizeFrame(profileData.avatarFrame);
    const accent = normalizeAccent(profileData.accentTheme);
    setSelectedFrame(frame);
    setSavedFrame(frame);
    setSelectedAccent(accent);
    setSavedAccent(accent);
  }, [profileData]);

  // Уровень из профиля сравниваем без регистра: чипы хранят ключи строчными
  const activeLevel = (cefrLevel || '').toLowerCase();
  const unlockedCodes = new Set(
    (progressData?.achievements ?? [])
      .filter((achievement) => achievement.unlocked)
      .map((achievement) => achievement.code)
  );

  const hasCustomizationChanges =
    selectedFrame !== savedFrame || selectedAccent !== savedAccent;
  const accentPreview = ACCENT_THEMES.find((accent) => accent.value === selectedAccent)?.swatch[mode]
    ?? ACCENT_THEMES[0].swatch[mode];

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

  const saveCustomization = async () => {
    setIsSavingCustomization(true);
    setCustomizationNotice('');
    setCustomizationError('');

    try {
      await apiMutate('/api/profile/customization', {
        token: session?.accessToken,
        method: 'PUT',
        body: { avatarFrame: selectedFrame, accentTheme: selectedAccent },
        invalidate: ['/api/profile'],
      });

      setSavedFrame(selectedFrame);
      setSavedAccent(selectedAccent);
      applyAccent(selectedAccent);
      writeAccent(selectedAccent);

      try {
        await update({ avatarFrame: selectedFrame, accentTheme: selectedAccent });
      } catch {
        // сервер уже сохранил; сессия подтянется при следующем входе
      }

      setCustomizationNotice('Оформление применено');
    } catch {
      setCustomizationError('Не удалось применить оформление. Попробуйте ещё раз.');
    } finally {
      setIsSavingCustomization(false);
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

  const accountEmail = (profileData?.email || session?.user?.email || '').trim();
  // Регистр и пробелы в адресе не считаем: человек печатает свою почту руками.
  const deletionEmailMatches =
    accountEmail.length > 0 && deletionEmail.trim().toLowerCase() === accountEmail.toLowerCase();

  const resetDeletionForm = () => {
    setIsConfirmingDeletion(false);
    setDeletionEmail('');
    setDeletionPassword('');
    setDeletionError('');
  };

  const deleteAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!deletionEmailMatches || deletionPassword.length === 0 || isDeletingAccount) return;

    setIsDeletingAccount(true);
    setDeletionError('');
    try {
      await apiMutate('/api/account', {
        token: session?.accessToken,
        method: 'DELETE',
        body: { password: deletionPassword },
      });

      // Кэш сбрасываем целиком: с удалённым аккаунтом не должен остаться в
      // памяти ни профиль, ни словарь, ни прогресс.
      invalidateCache();
      await signOut({ redirect: false });
      router.push('/login?reason=account-deleted');
    } catch (err) {
      setDeletionError(
        err instanceof ApiError
          ? err.message && !err.message.startsWith('Ошибка запроса')
            ? err.message
            : 'Не удалось удалить аккаунт. Попробуйте ещё раз.'
          : 'Сервер недоступен. Аккаунт не удалён.'
      );
      setIsDeletingAccount(false);
    }
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
              <UserAvatar
                avatarUrl={avatarUrl}
                frame={selectedFrame}
                name={displayName || session?.user?.email}
                className="h-16 w-16 shrink-0"
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

          <div className="space-y-6">
            <ThemePicker />

            <div>
              <h3 className="text-body-lg font-semibold text-ink">Акцент</h3>
              <p className={hintCls}>
                Меняет кнопки и мягкие акцентные поверхности. Светлая и тёмная тема
                остаются отдельным выбором.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3" role="group" aria-label="Акцентная тема">
                {ACCENT_THEMES.map((accent) => {
                  const swatch = accent.swatch[mode];
                  const active = selectedAccent === accent.value;
                  return (
                    <button
                      key={accent.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedAccent(accent.value);
                        setCustomizationNotice('');
                        setCustomizationError('');
                      }}
                      className={`rounded-lg border p-3 text-left transition-[border-color,box-shadow,transform] duration-fast ease-soft ${
                        active
                          ? 'border-primary shadow-card'
                          : 'border-hairline hover:border-hairline-strong'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-4 w-4 shrink-0 rounded-full"
                          style={{ background: swatch.primary }}
                          aria-hidden="true"
                        />
                        <span className="text-body-sm font-medium text-ink">{accent.label}</span>
                        {active && <CheckIcon size={16} className="ml-auto text-primary" />}
                      </span>
                      <span className="mt-1 block text-caption leading-snug text-slate">
                        {accent.description}
                      </span>
                      <span className="mt-3 flex flex-wrap items-center gap-2">
                        <span
                          className="rounded-md px-2 py-1 text-caption font-medium"
                          style={{
                            background: swatch.primary,
                            color: mode === 'dark' ? '#06202B' : '#FFFFFF',
                          }}
                        >
                          Читать
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-caption font-semibold"
                          style={{ background: swatch.soft, color: swatch.onSoft }}
                        >
                          XP
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-body-lg font-semibold text-ink">Рамка аватара</h3>
              <p className={hintCls}>
                Открывается за достижения. Рамка видна в сайдбаре, профиле и здесь.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Рамка аватара">
                {AVATAR_FRAMES.map((frame) => {
                  const unlocked = frameUnlocked(frame.id, unlockedCodes);
                  const active = selectedFrame === frame.id;
                  return (
                    <button
                      key={frame.id}
                      type="button"
                      aria-pressed={active}
                      disabled={!unlocked}
                      onClick={() => {
                        setSelectedFrame(frame.id);
                        setCustomizationNotice('');
                        setCustomizationError('');
                      }}
                      className={`rounded-lg border p-3 text-left transition-[border-color,box-shadow,transform] duration-fast ease-soft ${
                        active
                          ? 'border-primary shadow-card'
                          : 'border-hairline hover:border-hairline-strong'
                      } ${unlocked ? '' : 'cursor-not-allowed opacity-60'}`}
                    >
                      <span className="flex items-center gap-2">
                        <UserAvatar
                          avatarUrl={avatarUrl}
                          frame={frame.id}
                          name={displayName || session?.user?.email}
                          className="h-12 w-12 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 text-body-sm font-medium text-ink">
                            {frame.label}
                            {!unlocked && <LockIcon size={16} className="shrink-0 text-slate" />}
                          </span>
                          <span className="mt-0.5 block text-caption leading-snug text-slate">
                            {unlocked ? (active ? 'Выбрана' : 'Доступна') : frame.condition}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-hairline bg-surface p-4">
              <p className="text-caption font-semibold uppercase tracking-wide text-slate">
                Предпросмотр
              </p>
              <div className="mt-3 flex items-center gap-4">
                <UserAvatar
                  avatarUrl={avatarUrl}
                  frame={selectedFrame}
                  name={displayName || session?.user?.email}
                  className="h-14 w-14 shrink-0"
                />
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-semibold text-ink">
                    {displayName || session?.user?.email}
                  </p>
                  <p className="mt-0.5 text-caption text-slate">
                    {frameLabel(selectedFrame)} ·{' '}
                    {ACCENT_THEMES.find((accent) => accent.value === selectedAccent)?.label}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-md px-2.5 py-1 text-caption font-medium"
                      style={{
                        background: accentPreview.primary,
                        color: mode === 'dark' ? '#06202B' : '#FFFFFF',
                      }}
                    >
                      Продолжить
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-caption font-semibold"
                      style={{ background: accentPreview.soft, color: accentPreview.onSoft }}
                    >
                      XP
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {customizationNotice && <Notice>{customizationNotice}</Notice>}
            {customizationError && <Notice tone="danger">{customizationError}</Notice>}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={saveCustomization}
                disabled={isSavingCustomization || !hasCustomizationChanges}
                className="h-11"
              >
                {isSavingCustomization ? 'Применяем…' : 'Применить оформление'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedFrame(savedFrame);
                  setSelectedAccent(savedAccent);
                  setCustomizationNotice('');
                  setCustomizationError('');
                }}
                disabled={!hasCustomizationChanges}
                className="h-11"
              >
                Отменить выбор
              </Button>
            </div>

            <p className={hintCls}>
              Рамка и акцент сохраняются в профиле и переживают перезагрузку.
            </p>
          </div>
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

          {/*
           * Удаление данных (W2.5.3). Отдельный блок с двумя подтверждениями,
           * а не одна «смертельная» кнопка: запрос забирает очередь повторения,
           * заметки и загруженные EPUB без возможности восстановить, поэтому
           * сначала совпадение email, потом пароль.
           */}
          <div className="mt-6 border-t border-hairline pt-5">
            <h3 className="text-body-sm font-semibold text-ink">Удаление аккаунта</h3>
            <p className="mt-2 max-w-measure text-caption text-slate">
              Удаляются профиль, словарь и очередь повторения, прогресс по грамматике и темам, закладки и
              заметки, история повторений, события, копия писем и отзывов, а также все загруженные вами
              книги, обложки и аватар. Отменить нельзя.{' '}
              <Link href="/privacy" className="underline decoration-hairline-strong underline-offset-4 hover:text-ink">
                Что именно хранится
              </Link>
              .
            </p>

            {!isConfirmingDeletion ? (
              <Button
                variant="danger"
                className="mt-4"
                onClick={() => setIsConfirmingDeletion(true)}
              >
                Удалить аккаунт
              </Button>
            ) : (
              <form onSubmit={deleteAccount} className="mt-4 space-y-4 rounded-lg border border-hairline bg-canvas p-4">
                <p role="status" className="text-body-sm text-charcoal">
                  Шаг 1 из 2 — подтвердите адрес. Это удаление, а не выход: после него словари и прогресс
                  не восстановить.
                </p>

                <div>
                  <label htmlFor="delete-email" className={labelCls}>
                    Введите свой email: {accountEmail}
                  </label>
                  <input
                    id="delete-email"
                    type="email"
                    value={deletionEmail}
                    onChange={(e) => setDeletionEmail(e.target.value)}
                    autoComplete="off"
                    placeholder="точь-в-точь как в профиле"
                    className="input"
                    aria-invalid={deletionEmail.length > 0 && !deletionEmailMatches ? true : undefined}
                  />
                </div>

                {/*
                 * Поле с паролем появляется только когда адрес совпал: два
                 * шага читаются как «подумай», а не как форма на пять строк,
                 * которую прокликают не глядя.
                 */}
                {deletionEmailMatches && (
                  <div>
                    <label htmlFor="delete-password" className={labelCls}>
                      Шаг 2 — текущий пароль
                    </label>
                    <input
                      id="delete-password"
                      type="password"
                      value={deletionPassword}
                      onChange={(e) => setDeletionPassword(e.target.value)}
                      autoComplete="current-password"
                      className="input"
                    />
                    <p className={hintCls}>
                      Пароль нужен, чтобы удаление не случилось с чужой незакрытой вкладкой.
                    </p>
                  </div>
                )}

                {deletionError && <Notice tone="danger">{deletionError}</Notice>}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="submit"
                    variant="danger"
                    disabled={!deletionEmailMatches || deletionPassword.length === 0 || isDeletingAccount}
                  >
                    {isDeletingAccount ? 'Удаляем…' : 'Удалить аккаунт и все данные'}
                  </Button>
                  <Button variant="ghost" onClick={resetDeletionForm} disabled={isDeletingAccount}>
                    Отмена
                  </Button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
