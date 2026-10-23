export type AchievementCategory =
  | 'words'
  | 'reading'
  | 'reviews'
  | 'grammar'
  | 'streak'
  | 'challenges';

export const ACHIEVEMENT_CATEGORIES: { value: AchievementCategory; label: string }[] = [
  { value: 'words', label: 'Слова' },
  { value: 'reading', label: 'Чтение' },
  { value: 'reviews', label: 'Повторения' },
  { value: 'grammar', label: 'Грамматика' },
  { value: 'streak', label: 'Серия' },
  { value: 'challenges', label: 'Испытания' },
];

export const ACHIEVEMENT_CATEGORY_LABEL: Record<AchievementCategory, string> = {
  words: 'Слова',
  reading: 'Чтение',
  reviews: 'Повторения',
  grammar: 'Грамматика',
  streak: 'Серия',
  challenges: 'Испытания',
};

/** Категория выводится из кода: каталог стабилен и не требует лишнего поля в API. */
export function achievementCategory(code: string): AchievementCategory {
  if (/^first_word$|^words_|^first_untranslated$|^bulk_5$/.test(code)) return 'words';
  if (/^first_review$|^reviews_/.test(code)) return 'reviews';
  if (/^first_book$|^books_|^pages_/.test(code)) return 'reading';
  if (/^first_grammar$|^grammar_/.test(code)) return 'grammar';
  if (/^streak_|^days_/.test(code)) return 'streak';
  return 'challenges';
}

export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic';

export const ACHIEVEMENT_RARITY_LABEL: Record<AchievementRarity, string> = {
  common: 'Обычное',
  uncommon: 'Необычное',
  rare: 'Редкое',
  epic: 'Эпическое',
};

export const ACHIEVEMENT_RARITY_CLASS: Record<AchievementRarity, string> = {
  common: 'border border-hairline bg-surface text-slate',
  uncommon: 'bg-surface-info text-on-info',
  rare: 'bg-surface-decor text-on-decor',
  epic: 'bg-surface-warning text-on-warning',
};

/**
 * Редкость — не декорация, а честная шкала усилия: чем выше цель, тем реже
 * достижение. Не требует отдельного поля в каталоге и одинаково считается
 * на клиенте и в тосте.
 */
export function achievementRarity(target: number): AchievementRarity {
  if (target <= 1) return 'common';
  if (target <= 20) return 'uncommon';
  if (target <= 200) return 'rare';
  return 'epic';
}
