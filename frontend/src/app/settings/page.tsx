'use client';

import AppLayout from '@/components/AppLayout';
import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/app/lib/api-url';

interface Profile {
  email: string;
  displayName: string;
  cefrLevel: string | null;
  studyGoal: string | null;
  dailyGoalMinutes: number;
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
  const { data: session, status } = useSession();
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [cefrLevel, setCefrLevel] = useState<string>('');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(10);

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileToast, setProfileToast] = useState('');
  const [profileError, setProfileError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      loadProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const loadProfile = async () => {
    try {
      const res = await fetch(`${API_URL}/api/profile`, {
        headers: { Authorization: `Bearer ${session?.accessToken}` },
      });
      if (!res.ok) return;
      const data: Profile = await res.json();
      setDisplayName(data.displayName || '');
      setCefrLevel(data.cefrLevel || '');
      setDailyGoalMinutes(data.dailyGoalMinutes || 10);
    } catch {
      // профиль подтянется при следующем открытии страницы
    }
  };

  const saveProfile = async () => {
    setIsSavingProfile(true);
    setProfileToast('');
    setProfileError('');
    try {
      const res = await fetch(`${API_URL}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.accessToken}`,
        },
        body: JSON.stringify({
          displayName,
          cefrLevel: cefrLevel || null,
          dailyGoalMinutes,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setProfileToast('Профиль сохранён');
      setTimeout(() => setProfileToast(''), 3000);
    } catch {
      setProfileError('Не удалось сохранить профиль. Попробуйте ещё раз.');
    } finally {
      setIsSavingProfile(false);
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
      const res = await fetch(`${API_URL}/api/profile/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.accessToken}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.ok) {
        setPasswordSuccess('Пароль изменён');
        setCurrentPassword('');
        setNewPassword('');
        setRepeatPassword('');
      } else {
        const body = await res.json().catch(() => null);
        if (Array.isArray(body?.errors) && body.errors.length > 0) {
          setPasswordErrors(body.errors);
        } else {
          setPasswordErrors([body?.message || 'Не удалось сменить пароль']);
        }
      }
    } catch {
      setPasswordErrors(['Сервер недоступен. Попробуйте позже.']);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push('/login');
  };

  if (status === 'loading') {
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
