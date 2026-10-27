import { API_URL } from './api-url';
import {
  PLACEMENT_QUESTIONS_PATH,
  PLACEMENT_RESULT_PATH,
  type PlacementAnswer,
  type PlacementQuestion,
  type PlacementResult,
} from '@/lib/placement';

/*
 * Сетевой слой placement-теста. Держим его отдельно от чистой логики в
 * src/lib/placement.ts: тот модуль читают юнит-тесты без Next-алиасов, а этот —
 * единственный, кто знает про API_URL.
 *
 * Оба эндпоинта анонимные (`[AllowAnonymous]` в ProfileController), запросов с
 * токеном здесь нет намеренно: гость на /test должен проходить тест ровно тем
 * же путём, что и человек в онбординге.
 */

/**
 * Список вопросов. Бросает Error на любой не-2xx — экран решает, каким текстом
 * ответить и предлагать ли повтор.
 */
export async function fetchPlacementQuestions(): Promise<PlacementQuestion[]> {
  const res = await fetch(`${API_URL}${PLACEMENT_QUESTIONS_PATH}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const body = await res.json();
  return (body?.questions || []) as PlacementQuestion[];
}

/** Итоговые ответы → уровень. Ничего не сохраняет: результат живёт в браузере. */
export async function submitPlacementAnswers(
  answers: PlacementAnswer[]
): Promise<PlacementResult> {
  const res = await fetch(`${API_URL}${PLACEMENT_RESULT_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as PlacementResult;
}
