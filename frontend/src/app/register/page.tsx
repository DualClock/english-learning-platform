'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [data, setData] = useState({
    name: '',
    email: '',
    password: '',
    goal: '',
    time: '',
    level: '',
  });

  const updateData = (newData: Partial<typeof data>) => {
    setData(prev => ({ ...prev, ...newData }));
  };

  // Шаг 1: Имя
  if (step === 1) {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
        <div className="w-full max-w-md mx-auto mb-8">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Шаг 1 из 6</span>
          </div>
          <div className="h-2 bg-[#E7ECE4] rounded-full">
            <div className="h-full bg-[#356B52] rounded-full transition-all" style={{ width: '16%' }}></div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
          <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">Привет</h2>
          <p className="text-[#5A5F5A] text-center mb-8">Как тебя зовут?</p>

          <input
            type="text"
            value={data.name}
            onChange={(e) => updateData({ name: e.target.value })}
            placeholder="Твоё имя"
            className="w-full px-4 py-4 rounded-lg border border-[#D6D3CC] bg-white text-center text-lg mb-6 focus:outline-none focus:ring-2 focus:ring-[#356B52]"
            autoFocus
          />

          <button
            onClick={() => data.name.length >= 2 && setStep(2)}
            disabled={data.name.length < 2}
            className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Продолжить
          </button>
        </div>
      </div>
    );
  }

  // Шаг 2: Email
  if (step === 2) {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
        <div className="w-full max-w-md mx-auto mb-8">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Шаг 2 из 6</span>
          </div>
          <div className="h-2 bg-[#E7ECE4] rounded-full">
            <div className="h-full bg-[#356B52] rounded-full transition-all" style={{ width: '33%' }}></div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
          <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">Твой email</h2>
          <p className="text-[#5A5F5A] text-center mb-8">Пришлём подборку книг под твой уровень</p>

          <input
            type="email"
            value={data.email}
            onChange={(e) => updateData({ email: e.target.value })}
            placeholder="email@example.com"
            className="w-full px-4 py-4 rounded-lg border border-[#D6D3CC] bg-white text-center text-lg mb-6 focus:outline-none focus:ring-2 focus:ring-[#356B52]"
            autoFocus
          />

          <button
            onClick={() => data.email.includes('@') && setStep(3)}
            disabled={!data.email.includes('@')}
            className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Продолжить
          </button>

          <button onClick={() => setStep(1)} className="mt-4 text-[#5A5F5A] hover:text-[#20231F]">
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  // Шаг 3: Пароль
  if (step === 3) {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
        <div className="w-full max-w-md mx-auto mb-8">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Шаг 3 из 6</span>
          </div>
          <div className="h-2 bg-[#E7ECE4] rounded-full">
            <div className="h-full bg-[#356B52] rounded-full transition-all" style={{ width: '50%' }}></div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
          <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">Придумай пароль</h2>
          <p className="text-[#5A5F5A] text-center mb-8">Минимум 6 символов</p>

          <input
            type="password"
            value={data.password}
            onChange={(e) => updateData({ password: e.target.value })}
            placeholder="Пароль"
            className="w-full px-4 py-4 rounded-lg border border-[#D6D3CC] bg-white text-center text-lg mb-6 focus:outline-none focus:ring-2 focus:ring-[#356B52]"
            autoFocus
          />

          <button
            onClick={() => data.password.length >= 6 && setStep(4)}
            disabled={data.password.length < 6}
            className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Продолжить
          </button>

          <button onClick={() => setStep(2)} className="mt-4 text-[#5A5F5A] hover:text-[#20231F]">
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  // Шаг 4: Цель
  const goals = [
    { id: 'travel', icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, title: 'Путешествия' },
    { id: 'work', icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>, title: 'Работа' },
    { id: 'movies', icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>, title: 'Фильмы' },
    { id: 'books', icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>, title: 'Книги' },
    { id: 'talk', icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>, title: 'Общение' },
    { id: 'exam', icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>, title: 'Экзамен' },
  ];

  if (step === 4) {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
        <div className="w-full max-w-md mx-auto mb-8">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Шаг 4 из 6</span>
          </div>
          <div className="h-2 bg-[#E7ECE4] rounded-full">
            <div className="h-full bg-[#356B52] rounded-full transition-all" style={{ width: '66%' }}></div>
          </div>
        </div>

        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">Зачем тебе английский</h2>
          <p className="text-[#5A5F5A] text-center mb-8">Выбери главную цель</p>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => updateData({ goal: goal.id })}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  data.goal === goal.id
                    ? 'border-[#356B52] bg-[#E7ECE4]'
                    : 'border-[#D6D3CC] bg-white hover:border-[#C4A77D]'
                }`}
              >
                <div className="text-[#356B52] mb-2">{goal.icon}</div>
                <span className="font-medium text-[#20231F]">{goal.title}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => data.goal && setStep(5)}
            disabled={!data.goal}
            className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Продолжить
          </button>

          <button onClick={() => setStep(3)} className="mt-4 text-[#5A5F5A] hover:text-[#20231F] mx-auto">
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  // Шаг 5: Время
  const times = [
    { id: '5', label: '5 минут' },
    { id: '15', label: '15 минут' },
    { id: '30', label: '30 минут' },
    { id: '60', label: 'Час и больше' },
  ];

  if (step === 5) {
    return (
      <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
        <div className="w-full max-w-md mx-auto mb-8">
          <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
            <span>Шаг 5 из 6</span>
          </div>
          <div className="h-2 bg-[#E7ECE4] rounded-full">
            <div className="h-full bg-[#356B52] rounded-full transition-all" style={{ width: '83%' }}></div>
          </div>
        </div>

        <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
          <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">Сколько времени</h2>
          <p className="text-[#5A5F5A] text-center mb-8">В день, честно</p>

          <div className="space-y-3 mb-8">
            {times.map((time) => (
              <button
                key={time.id}
                onClick={() => updateData({ time: time.id })}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  data.time === time.id
                    ? 'border-[#356B52] bg-[#E7ECE4]'
                    : 'border-[#D6D3CC] bg-white hover:border-[#C4A77D]'
                }`}
              >
                <span className="font-semibold text-[#20231F]">{time.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => data.time && setStep(6)}
            disabled={!data.time}
            className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Продолжить
          </button>

          <button onClick={() => setStep(4)} className="mt-4 text-[#5A5F5A] hover:text-[#20231F] mx-auto">
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  // Шаг 6: Уровень
  const levels = [
    { id: 'a1', title: 'A1' },
    { id: 'a2', title: 'A2' },
    { id: 'b1', title: 'B1' },
    { id: 'b2', title: 'B2' },
    { id: 'c1', title: 'C1' },
  ];

  const timesMinutes: Record<string, number> = { '5': 5, '15': 15, '30': 30, '60': 60 };

  const handleRegister = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          displayName: data.name,
          ...(data.level ? { cefrLevel: data.level } : {}),
          ...(data.goal ? { studyGoal: data.goal } : {}),
          ...(data.time ? { dailyGoalMinutes: timesMinutes[data.time] ?? Number(data.time) } : {}),
        }),
      });

      if (!res.ok) {
        let message = 'Не удалось создать аккаунт. Попробуйте ещё раз.';
        try {
          const body = await res.json();
          if (Array.isArray(body) && body.length > 0) {
            message = body.map((e: { description?: string }) => e.description).filter(Boolean).join(' ');
          } else if (typeof body?.message === 'string') {
            message = body.message;
          }
        } catch {
          // оставляем сообщение по умолчанию
        }
        setError(message);
        return;
      }

      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        setError('Аккаунт создан, но автовход не удался — войдите вручную');
        router.push('/login');
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      console.error('Registration error:', err);
      setError('Сервер недоступен, попробуйте позже');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F5EF] flex flex-col p-6">
      <div className="w-full max-w-md mx-auto mb-8">
        <div className="flex justify-between text-sm text-[#5A5F5A] mb-2">
          <span>Шаг 6 из 6</span>
        </div>
        <div className="h-2 bg-[#E7ECE4] rounded-full">
          <div className="h-full bg-[#356B52] rounded-full transition-all" style={{ width: '100%' }}></div>
        </div>
      </div>

      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <h2 className="text-2xl font-bold text-[#20231F] text-center mb-2">Твой уровень</h2>
        <p className="text-[#5A5F5A] text-center mb-8">Примерно, потом уточним</p>

        <div className="flex flex-wrap gap-2 justify-center mb-4">
          {levels.map((level) => (
            <button
              key={level.id}
              onClick={() => updateData({ level: level.id })}
              className={`px-5 py-2.5 rounded-full border-2 text-sm font-semibold transition-all ${
                data.level === level.id
                  ? 'border-[#356B52] bg-[#E7ECE4] text-[#356B52]'
                  : 'border-[#D6D3CC] bg-white text-[#20231F] hover:border-[#C4A77D]'
              }`}
            >
              {level.title}
            </button>
          ))}
          <button
            onClick={() => updateData({ level: '' })}
            className={`px-5 py-2.5 rounded-full border-2 border-dashed text-sm font-medium transition-all ${
              !data.level
                ? 'border-[#356B52] bg-[#E7ECE4] text-[#356B52]'
                : 'border-[#C4A77D] text-[#5A5F5A] hover:border-[#356B52]'
            }`}
          >
            пройду тест позже
          </button>
        </div>

        <p className="text-center text-sm text-[#5A5F5A] mb-8">
          Цель: {goals.find((g) => g.id === data.goal)?.title || '—'} · Время: {times.find((t) => t.id === data.time)?.label || '—'}
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-[#B85C5C]/10 border border-[#B85C5C] text-[#B85C5C] text-sm mb-6">
            {error}
          </div>
        )}

        <button
          onClick={handleRegister}
          disabled={isSubmitting}
          className="w-full py-4 bg-[#356B52] text-white rounded-lg font-medium hover:bg-[#2A5542] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting ? 'Создаём аккаунт...' : 'Создать аккаунт'}
        </button>

        <button onClick={() => setStep(5)} className="mt-4 text-[#5A5F5A] hover:text-[#20231F] mx-auto">
          ← Назад
        </button>
      </div>
    </div>
  );
}