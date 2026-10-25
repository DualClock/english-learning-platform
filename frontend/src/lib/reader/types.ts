import type { ReaderAnchor } from './pagination';

export type { ReaderAnchor };

export type ReaderTheme = 'day' | 'sepia' | 'night';

export interface ReaderBook {
  id: number;
  title: string;
  author?: string | null;
  language?: string | null;
  coverUrl?: string | null;
  wordCount: number;
}

export interface ReaderManifestChapter {
  id: string;
  title: string;
  level: number;
  wordStart: number;
  wordCount: number;
}

export interface ReaderPosition {
  chapterId: string;
  sentenceId: string;
  charOffset: number;
  maxPercent: number;
  finishedAt?: string | null;
}

export interface ReaderBookmark {
  id: number;
  page?: number | null;
  chapterId?: string | null;
  sentenceId?: string | null;
  charOffset: number;
  excerpt?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface ReaderManifest {
  book: ReaderBook;
  manifest: ReaderManifestChapter[];
  position: ReaderPosition;
  pocketCount: number;
  bookmarks: ReaderBookmark[];
}

export interface ReaderSentence {
  id: string;
  text: string;
  wordStart: number;
  wordCount: number;
}

export interface ReaderBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'quote' | 'listItem' | 'verse' | 'image' | 'separator';
  sentences: ReaderSentence[];
  asset?: string | null;
  assetUrl?: string | null;
  alt?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ReaderPocketItem {
  id: number;
  word: string;
  translationRu?: string | null;
  partOfSpeech?: string | null;
  sentenceId?: string | null;
  sentenceText?: string | null;
  chapterId?: string | null;
  createdAt: string;
}

export interface ReaderWordStatus {
  known: string[];
  learning: string[];
  pocket: ReaderPocketItem[];
}

export interface ReaderChapterDifficulty {
  totalWords: number;
  knownWords: number;
  learningWords: number;
  newWords: number;
  knownPercent: number;
}

export interface ReaderChapter {
  id: string;
  title: string;
  level: number;
  index: number;
  totalChapters: number;
  wordStart: number;
  wordCount: number;
  blocks: ReaderBlock[];
  wordStatus: ReaderWordStatus;
  difficulty: ReaderChapterDifficulty;
}

export interface ReaderWordLookup {
  word: string;
  translationRu?: string | null;
  translation?: string | null;
  cefrLevel?: string | null;
  freqRank?: number | null;
  partOfSpeech?: string | null;
  alternatives?: string[] | null;
  source?: string | null;
}

export interface ReaderSentenceTranslation {
  translation: string;
  source?: string;
}

export interface ReaderReviewResponse {
  items: ReaderPocketItem[];
}

export interface ReaderPocketListResponse {
  items: ReaderPocketItem[];
}

export interface ReaderPositionResponse {
  chapterId: string;
  sentenceId: string;
  charOffset: number;
  maxPercent: number;
  wordsRead: number;
  finished?: boolean;
}

export interface ReaderSpeechSegment {
  sentenceId: string;
  url: string;
}

export interface ReaderSpeechManifest {
  available: boolean;
  voice: string;
  segments: ReaderSpeechSegment[];
}

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  margin: number;
  theme: ReaderTheme;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 20,
  lineHeight: 1.75,
  margin: 8,
  theme: 'sepia',
};

export const READER_SETTINGS_KEY = 'reader_v3_settings_v1';

export const MIN_FONT_SIZE = 17;
export const MAX_FONT_SIZE = 28;
export const MIN_LINE_HEIGHT = 1.5;
export const MAX_LINE_HEIGHT = 2;
export const MIN_MARGIN = 4;
export const MAX_MARGIN = 12;

export const READER_THEME_LABELS: Record<ReaderTheme, string> = {
  day: 'День',
  sepia: 'Сепия',
  night: 'Ночь',
};

export interface ReaderSettingsMenu {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}
