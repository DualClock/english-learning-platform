export interface DictionaryDefinition {
  id: number;
  definition: string;
  partOfSpeech?: string | null;
  example?: string | null;
}

export interface DictionaryWord {
  id: number;
  text: string;
  language?: string | null;
  definitions: DictionaryDefinition[];
  createdAt: string;
  source?: string | null;
  context?: string | null;
  emoji?: string | null;
  imageUrl?: string | null;
  categoryIcon?: string | null;
}

export interface DictionaryTranslation {
  translation: string;
  alternatives?: string[];
  partOfSpeech?: string;
  source?: string;
  examples?: { english: string; translation: string }[];
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'вручную',
  reader: 'из книги',
  key_word: 'из главы',
  grammar: 'из грамматики',
  list: 'из сборника',
  quiz: 'из теста',
  category: 'из категории',
  bulk: 'списком',
};

export function sourceLabel(source?: string | null): string {
  if (!source) return '';
  return SOURCE_LABELS[source] ?? 'из словаря';
}

export function translationSourceLabel(source?: string): string {
  if (source === 'level_map') return 'из словаря';
  if (source === 'ai' || source === 'gtx') return 'AI';
  return 'сервис перевода';
}
