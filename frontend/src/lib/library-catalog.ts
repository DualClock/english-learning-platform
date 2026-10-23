/*
 * Единственная точка, откуда серверные компоненты /library берут каталог книг.
 *
 * ТОЛЬКО для серверных компонентов: модуль читает node:fs и ходит на бэкенд.
 * Клиентскому коду его импортировать нельзя — и никто не импортирует: оба
 * потребителя (src/app/library/page.tsx и src/app/library/[slug]/page.tsx) плюс
 * sitemap.ts выполняются на сервере.
 *
 * Порядок источников (это же ответ на вопрос «какой источник правды»):
 *  1. GET /api/catalog/books — правый источник: слаг, whitelist «только строки
 *     Books без владельца», объём и превью считает бэкенд;
 *  2. зеркало сида — если бэкенда нет (локальная сборка фронтенда без поднятого
 *     API, CI). Рассказы читаются из того же Data/Seed/stories.json, который
 *     читает StorySeeder, поэтому не могут разойтись с боевым сидом; список
 *     классик лежит в src/lib/library.ts и сверен с PopularBooksService тестом.
 *
 * В зеркале сознательно пусто то, чего мы не знаем без бэкенда: объём классики,
 * её превью и обложки. Страница обязана оставаться валидной витриной и без этих
 * полей — придумывать цифры она не имеет права.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PUBLIC_CLASSICS,
  assembleShelf,
  resolveCatalogPayload,
  storyFromSeed,
  type PublicBook,
  type PublicCatalog,
  type SeedStory,
} from './library';

/**
 * Совпадает с src/app/lib/api-url.ts; продублировано, потому что тот модуль
 * импортируется по алиасу @/ и недоступен обычному node из юнит-теста.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5226';

/**
 * Сколько ждать ответ бэкенда при сборке страницы. Сборка и краулер не должны
 * зависать из-за молчащего API: таймаут — это предсказуемый переход на зеркало.
 */
const FETCH_TIMEOUT_MS = 4000;

/** Каталог меняется редко, но без ручного редиплоя — раз в час. */
const CATALOG_REVALIDATE_SECONDS = 3600;

/** Переопределяется только в тестах и при нестандартной раскладке репозитория. */
const STORIES_SEED_ENV = 'LIBRARY_STORIES_SEED';

/*
 * В monorepo фронт собирается из frontend/, а сид лежит рядом в API-проекте.
 * Путь считается от cwd, поэтому в изолированной сборке фронтенда (контейнер
 * только с frontend/) файла нет — и зеркало честно сжимается до классик.
 */
const SEED_RELATIVE_PATH = ['..', 'EnglishLearningPlatform.API', 'Data', 'Seed', 'stories.json'];

export function catalogApiUrl(): string {
  return `${API_BASE.replace(/\/+$/, '')}/api/catalog/books`;
}

/** Каталог для SSR: бэкенд, а если его нет — зеркало сида. Никогда не бросает. */
export async function loadPublicCatalog(): Promise<PublicCatalog> {
  const mirror = shelfMirror();

  try {
    const response = await fetch(catalogApiUrl(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: CATALOG_REVALIDATE_SECONDS },
    });

    if (!response.ok) throw new Error(`catalog responded ${response.status}`);

    return resolveCatalogPayload(await response.json(), mirror);
  } catch (error) {
    console.warn(
      '[library] каталог с бэкенда недоступен, отдаю зеркало сида:',
      error instanceof Error ? error.message : error,
    );

    return { books: mirror, source: 'seed' };
  }
}

/** Одна книга по слагу — для generateMetadata и страницы книги. */
export async function loadPublicBook(slug: string): Promise<PublicBook | null> {
  const wanted = slug?.trim();
  if (!wanted) return null;

  const { books } = await loadPublicCatalog();

  return books.find((book) => book.slug === wanted) ?? null;
}

/** Витрина без бэкенда: зеркало классик + рассказы из сида на диске. */
export function shelfMirror(): PublicBook[] {
  return assembleShelf(PUBLIC_CLASSICS, readSeedStories());
}

function readSeedStories(): PublicBook[] {
  const path = process.env[STORIES_SEED_ENV] ?? resolve(process.cwd(), ...SEED_RELATIVE_PATH);

  if (!existsSync(path)) return [];

  let stories: unknown;
  try {
    stories = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.warn('[library] сид рассказов не разобрался:', error instanceof Error ? error.message : error);
    return [];
  }

  if (!Array.isArray(stories)) return [];

  return (stories as SeedStory[])
    .map(storyFromSeed)
    .filter((book): book is PublicBook => book !== null);
}
