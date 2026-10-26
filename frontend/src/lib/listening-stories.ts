/*
 * Рассказы для /listening: единственная точка, откуда страница берёт текст.
 *
 * ТОЛЬКО серверный код — модуль читает node:fs, поэтому в клиентский компонент
 * его импортировать нельзя (next/headers и fs попадут в бандл). Страница
 * слушает его в серверной обёртке и передаёт готовый массив в плеер.
 *
 * Источник — тот же файл, который читает StorySeeder на бэкенде:
 * EnglishLearningPlatform.API/Data/Seed/stories.json. Почему не
 * GET /api/books/stories: тот эндпоинт за [Authorize] + [RequireConfirmedEmail]
 * и отдаёт только метаданные (title, cefrLevel, description, coverUrl) — самих
 * абзацев в ответе нет. Аудирование без текста бессмысленно, поэтому берём
 * источник правды напрямую.
 *
 * Ключи читаются в обоих регистрах по той же причине, что и в library.ts:
 * StorySeeder использует PropertyNameCaseInsensitive, и зеркало обязано читать
 * сид независимо от того, в каком регистре он лежит на диске. Иначе пересборка
 * сида в PascalCase тихо обнулила бы страницу.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ListeningStory } from '@/app/listening/ListeningPlayer';

/** Форма записи сида: camelCase плюс PascalCase-дубли (см. комментарий выше). */
interface SeedStory {
  title?: string;
  Title?: string;
  author?: string;
  Author?: string;
  cefrLevel?: string;
  CefrLevel?: string;
  description?: string;
  Description?: string;
  paragraphs?: string[];
  Paragraphs?: string[];
}

/**
 * Путь считается от cwd фронтенда: в monorepo сид лежит рядом в API-проекте.
 * Переопределяется только тестами и нестандартной раскладкой репозитория.
 */
const SEED_ENV = 'LISTENING_STORIES_SEED';
const SEED_RELATIVE_PATH = ['..', 'EnglishLearningPlatform.API', 'Data', 'Seed', 'stories.json'];

export function listeningSeedPath(): string {
  return process.env[SEED_ENV] ?? resolve(process.cwd(), ...SEED_RELATIVE_PATH);
}

/**
 * Словарь категорий — источник слова и его русского перевода для режима
 * «впишите слово». Берём существующий сид, а не модель: выдуманный перевод в
 * упражнении на понимание хуже, чем отсутствие упражнения.
 */
const WORDS_ENV = 'LISTENING_WORDS_SEED';
const WORDS_RELATIVE_PATH = ['..', 'EnglishLearningPlatform.API', 'Data', 'Seed', 'categories.json'];

export function listeningWordsSeedPath(): string {
  return process.env[WORDS_ENV] ?? resolve(process.cwd(), ...WORDS_RELATIVE_PATH);
}

function text(camel?: string, pascal?: string): string {
  return (camel ?? '').trim() || (pascal ?? '').trim();
}

function paragraphsOf(story: SeedStory): string[] {
  const source = Array.isArray(story.paragraphs)
    ? story.paragraphs
    : Array.isArray(story.Paragraphs)
      ? story.Paragraphs
      : [];

  return source
    .filter((paragraph): paragraph is string => typeof paragraph === 'string')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Стабильный id: индекс в сиде. Заголовок для этого не годится — его могут
 * поправить, и сохранённое место в localStorage потерялось бы.
 */
export function normalizeStory(value: unknown, index: number): ListeningStory | null {
  if (typeof value !== 'object' || value === null) return null;

  const story = value as SeedStory;
  const title = text(story.title, story.Title);
  const paragraphs = paragraphsOf(story);

  // Рассказ без названия или без единого абзаца слушать нельзя: его нечем
  // показать и нечего подсвечивать.
  if (!title || paragraphs.length === 0) return null;

  const cefrLevel = text(story.cefrLevel, story.CefrLevel).toUpperCase() || 'A1';

  return {
    id: (story.title ?? story.Title ?? String(index)).trim().toLowerCase().replace(/\s+/g, '-') || String(index),
    title,
    author: text(story.author, story.Author) || 'Lexicon Stories',
    cefrLevel,
    description: text(story.description, story.Description),
    paragraphs,
  };
}

/**
 * Рассказы для плеера. Никогда не бросает: страница без рассказов покажет
 * честное «текст не загрузился», а не 500.
 */
export async function loadListeningStories(): Promise<ListeningStory[]> {
  const path = listeningSeedPath();
  if (!existsSync(path)) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }

  if (!Array.isArray(raw)) return [];

  const vocabulary = loadVocabulary();

  return raw
    .map((entry, index) => normalizeStory(entry, index))
    .filter((story): story is ListeningStory => story !== null)
    .map((story) => ({ ...story, practiceWords: practiceWordsFor(story.paragraphs, vocabulary) }));
}

interface VocabularyEntry {
  word: string;
  translation: string;
}

/**
 * Перевод из словаря бывает в форме «лес», «буря, шторм», «домашнее задание».
 * В упражнении нужен ровно один ответ: первый синоним — так человек не
 * угадывает, какой из пяти вариантов имел в виду автор курса.
 */
function primaryTranslation(value: string): string {
  return (value.split(/[,;/]/)[0] ?? '').trim();
}

/**
 * Слово и перевод из `categories.json`. Форма файла — `{ categories: [...] }`,
 * но на диске бывают и голые списки (см. `library.ts`), поэтому поддержаны
 * оба варианта; ключи — в обоих регистрах, как у рассказов.
 */
function loadVocabulary(): VocabularyEntry[] {
  const path = listeningWordsSeedPath();
  if (!existsSync(path)) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }

  const source = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { categories?: unknown }).categories)
      ? ((raw as { categories: unknown[] }).categories)
      : [];

  const entries: VocabularyEntry[] = [];

  for (const category of source) {
    if (typeof category !== 'object' || category === null) continue;

    const words = (category as { words?: unknown; Words?: unknown }).words
      ?? (category as { Words?: unknown }).Words;

    if (!Array.isArray(words)) continue;

    for (const item of words) {
      if (typeof item !== 'object' || item === null) continue;

      const record = item as Record<string, unknown>;
      const word = String(record.english ?? record.English ?? '').trim();
      const translation = primaryTranslation(String(record.translation ?? record.Translation ?? ''));

      if (word && translation) entries.push({ word, translation });
    }
  }

  return entries;
}

export interface PracticeWord {
  /** Слово в форме рассказа: оно же ищется в предложении для пропуска */
  word: string;
  /** Русский перевод из сида — единственный источник, здесь ничего не выдумано */
  translation: string;
}

/**
 * Слова рассказа, по которым можно сделать пропуск: ищем словарь прямо в тексте,
 * по одному на предложение и не больше шести на рассказ. Больше — это уже не
 * аудирование, а диктант по непонятным словам.
 */
const PRACTICE_WORDS_PER_STORY = 6;

function practiceWordsFor(paragraphs: readonly string[], vocabulary: readonly VocabularyEntry[]): PracticeWord[] {
  if (vocabulary.length === 0) return [];

  const byWord = new Map(vocabulary.map((entry) => [entry.word.toLowerCase(), entry]));
  const seen = new Set<string>();
  const picked: PracticeWord[] = [];

  for (const paragraph of paragraphs) {
    for (const token of paragraph.split(/[^A-Za-z']+/)) {
      const entry = byWord.get(token.toLowerCase());
      if (!entry || seen.has(entry.word.toLowerCase())) continue;

      seen.add(entry.word.toLowerCase());
      picked.push({ word: entry.word, translation: entry.translation });

      if (picked.length >= PRACTICE_WORDS_PER_STORY) return picked;
    }
  }

  return picked;
}
