/** Тот же набор, что WordVisualCatalog на API. */
export const WORD_EMOJIS = [
  '🍎', '🍞', '☕', '🥛', '🌊', '🌿', '🌻', '☀️',
  '🌙', '🔥', '❄️', '🏠', '🚗', '✈️', '🎒', '📚',
  '✏️', '💡', '🔑', '🕰️', '🎵', '🎨', '💬', '❤️',
  '😊', '😢', '😴', '🏃', '🧠', '💰', '⚽', '🐈',
] as const;

export const WORD_IMAGE_PREFIX = '/uploads/word-images/';

export function resolveWordImageSrc(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith(WORD_IMAGE_PREFIX)) {
    return `/api/word-image/${encodeURIComponent(imageUrl.slice(WORD_IMAGE_PREFIX.length))}`;
  }
  return imageUrl;
}
