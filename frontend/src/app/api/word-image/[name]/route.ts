import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226';
const WORD_IMAGE_FILE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

export const dynamic = 'force-dynamic';

// Картинка слова приватная. Браузер шлёт куку сессии на тот же домен,
// а роут уже проверяет сессию и запрашивает файл у API с Bearer-токеном.
export async function GET(req: NextRequest, { params }: { params: { name: string } }) {
  const { name } = params;
  if (!WORD_IMAGE_FILE.test(name)) {
    return new NextResponse(null, { status: 404 });
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) {
    return new NextResponse(null, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/files/word-images/${name}`, {
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
      'Cache-Control': 'private, max-age=300',
    },
  });
}
