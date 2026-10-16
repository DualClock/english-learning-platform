import { useSession } from 'next-auth/react';
import { API_URL } from '@/app/lib/api-url';

/**
 * Отправка аналитического события на бэкенд.
 * Никогда не бросает исключений и не ломает UX: все ошибки проглатываются.
 *
 * sessionAccessToken передаётся явно (из useSession().data.accessToken),
 * чтобы хелпер можно было вызывать из любого места компонента.
 */
export async function track(
  event: string,
  meta?: string,
  sessionAccessToken?: string | null
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionAccessToken) {
      headers.Authorization = `Bearer ${sessionAccessToken}`;
    }

    await fetch(`${API_URL}/api/analytics/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event, meta }),
    });
  } catch {
    // аналитика не должна ломать UX
  }
}

/** Удобный хук: возвращает track с уже подставленным токеном сессии. */
export function useTrack() {
  const { data: session } = useSession();
  const token = session?.accessToken ?? null;
  return (event: string, meta?: string) => track(event, meta, token);
}
