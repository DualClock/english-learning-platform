export const DEFAULT_AVATARS = Array.from({ length: 10 }, (_, i) => `avatar-${i + 1}`);
export const FALLBACK_AVATAR_SRC = '/avatars/avatar-1.svg';

// Базовые аватары лежат во фронте (/avatars/*.svg), загруженные — в API,
// но не по публичной статике: их отдаёт /api/avatar/* после проверки сессии.
export function resolveAvatarSrc(avatarUrl?: string | null): string {
  if (!avatarUrl) return FALLBACK_AVATAR_SRC;

  const uploadedPrefix = '/uploads/avatars/';
  if (avatarUrl.startsWith(uploadedPrefix)) {
    const fileName = avatarUrl.slice(uploadedPrefix.length);
    return `/api/avatar/${encodeURIComponent(fileName)}`;
  }

  return avatarUrl;
}
