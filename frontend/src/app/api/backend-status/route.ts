import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226';

/**
 * Состояние бэкенда для страницы входа: позволяет отличить «неверный пароль»
 * от «сервер или база недоступны». Всегда отвечает 200 — вызывающему нужен
 * только флаг, а не HTTP-ошибка.
 */
export async function GET() {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    const database = Array.isArray(body?.checks)
      ? body.checks.find((check: { name?: string }) => check?.name === 'database')?.status ?? null
      : null;

    return NextResponse.json({ ok: res.ok, database });
  } catch {
    // Сам API не отвечает — считаем недоступным
    return NextResponse.json({ ok: false, database: 'unreachable' });
  }
}
