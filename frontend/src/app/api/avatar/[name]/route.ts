import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226';

// Загруженный аватар лежит за авторизацией в API, а <img> не умеет слать
// Bearer-токен. Поэтому браузер ходит на этот же домен (кука сессии уходит
// автоматически), а роут уже от себя запрашивает файл у API.
const AVATAR_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { name: string } }) {
  const { name } = params;
  if (!AVATAR_FILE.test(name)) {
    return new NextResponse(null, { status: 404 });
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) {
    return new NextResponse(null, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/files/avatars/${name}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      // Аватар личный, поэтому кэш только в браузере
      'Cache-Control': 'private, max-age=300',
    },
  });
}
