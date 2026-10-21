export interface Book {
  id: number;
  title: string;
  author?: string;
  language?: string;
}

export interface KeyWord {
  wordText: string;
  cefrLevel?: string;
}

export interface BookContent {
  text: string;
  currentPage: number;
  totalPages: number;
  totalWords: number;
  wordsRead: number;
  progress: number;
  keyWords?: KeyWord[];
}

export interface TranslationResult {
  translation: string;
  alternatives?: string[];
  partOfSpeech?: string;
  source?: string;
  examples?: { english: string; translation: string }[];
}

export interface WordToken {
  word: string;
  start: number;
  end: number;
}

export interface TooltipData {
  word: string;
  cefrLevel?: string;
  translationRu?: string;
  freqRank?: number;
  translation?: string;
}

export interface TooltipState {
  idx: number;
  word: string;
  data: TooltipData | null;
  loading: boolean;
  below: boolean;
}

export interface CollectedWord {
  text: string;
  page: number;
  sentence: string;
}

export interface QuizQuestion {
  wordText: string;
  options: string[];
  correctIndex: number;
}

export interface FinishResult {
  added: number;
  minutes: number;
  quiz?: { questions: QuizQuestion[] };
}

export interface ParallelChunk {
  en: string;
  ru: string | null;
}

export interface TocItem {
  title: string;
  page: number;
  level: number;
}

export interface PageDifficulty {
  page: number;
  totalWords: number;
  known: number;
  learning: number;
  newWords: number;
  knownPercent: number;
  learningPercent: number;
  newPercent: number;
}

export interface BookDifficulty {
  pages: PageDifficulty[];
  average: PageDifficulty;
  totalWords: number;
  knownWordCount: number;
  learningWordCount: number;
}

export interface Bookmark {
  id: number;
  page: number;
  note?: string | null;
  createdAt: string;
}

export const SENTENCE_ENDINGS = '.!?…';

export function getSentenceContext(text: string, start: number, end: number): string {
  let s = start - 1;
  while (s >= 0 && !SENTENCE_ENDINGS.includes(text[s])) s--;
  let e = end;
  while (e < text.length && !SENTENCE_ENDINGS.includes(text[e])) e++;
  if (e < text.length) e++;
  return text.slice(s + 1, e).trim();
}

export const TOOLTIP_DELAY = 250;

export const TUTORIAL_STORAGE_KEY = 'reader_tutorial_seen';
export const AI_MODE_STORAGE_KEY = 'reader_ai_mode';
export const FONT_SIZE_STORAGE_KEY = 'reader_font_size';
export const LINE_WIDTH_STORAGE_KEY = 'reader_line_width';

export const MIN_FONT_SIZE = 16;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 20;
export const MIN_LINE_WIDTH = 45;
export const MAX_LINE_WIDTH = 90;
export const DEFAULT_LINE_WIDTH = 65;

// Свайп должен быть заметно горизонтальным, иначе это скролл или тап по слову
export const SWIPE_MIN_DISTANCE = 60;
export const SWIPE_DIRECTION_RATIO = 1.5;

export const TUTORIAL_STEPS: {
  text: string;
  circle: { top: string; left: string; size: number };
  card: { top: string; left: string };
}[] = [
  {
    text: 'Кликните на любое слово — получите мгновенный перевод',
    circle: { top: '48%', left: '40%', size: 110 },
    card: { top: '62%', left: '40%' },
  },
  {
    text: 'Слова с ✦ — маркеры: кликните, чтобы собрать в конспект. В конце чтения — мини-тест',
    circle: { top: '56%', left: '44%', size: 110 },
    card: { top: '70%', left: '44%' },
  },
  {
    text: 'Включите RU — увидите параллельный перевод страницы',
    circle: { top: '13%', left: '76%', size: 90 },
    card: { top: '22%', left: '70%' },
  },
  {
    text: 'Здесь ваш конспект. Завершите чтение — и получите тест + новые слова в словарь',
    circle: { top: '13%', left: '86%', size: 90 },
    card: { top: '22%', left: '80%' },
  },
];
