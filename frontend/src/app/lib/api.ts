import { getSession } from 'next-auth/react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226/api';

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const session = await getSession();
  const token = session?.accessToken;

  const res = await fetch(`${API_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Dictionary
  getWords: () => fetchWithAuth('/dictionary'),
  addWord: (data: { text: string; definition: string; partOfSpeech?: string; example?: string }) =>
    fetchWithAuth('/dictionary', { method: 'POST', body: JSON.stringify(data) }),

  // Review
  getTodayReview: () => fetchWithAuth('/review/today'),
  reviewWord: (wordId: number, quality: number) =>
    fetchWithAuth(`/review/${wordId}/quality/${quality}`, { method: 'POST' }),
};
