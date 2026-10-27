'use client';

import { useState } from 'react';
import { hasIllustration, illustrationSrc } from '@/lib/wordIllustrations.generated';

type IllustrationSize = 'sm' | 'md' | 'lg';
type IllustrationVariant = 'tile' | 'bare';

/**
 * URL загруженной картинки слова.
 *
 * В базе лежит относительный путь `/uploads/word-images/<guid>.webp` — он не
 * зависит от хоста, поэтому переживает переезд и смену домена. Отдаёт файл API
 * по публичному маршруту `/api/word-images/{name}`, как это и было задумано
 * для картинок категорий (личные картинки пользователя живут в другом
 * маршруте с проверкой владельца).
 */
export function uploadedImageSrc(imageUrl: string): string {
  const prefix = '/uploads/word-images/';
  if (!imageUrl.startsWith(prefix)) return imageUrl;
  const name = imageUrl.slice(prefix.length);
  const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5226';
  return `${api}/api/word-images/${encodeURIComponent(name)}`;
}

/**
 * Размеры — одной таблицей: список берёт sm, флэшкарта lg, а слот на обороте
 * карточки резервирует ровно тот же класс. Иначе при перевороте карточка
 * меняет высоту и кнопки «Знаю / Не знаю» уезжают из-под пальца.
 */
export const ILLUSTRATION_SIZE_CLASS: Record<IllustrationSize, string> = {
  sm: 'h-14 w-14',
  md: 'h-16 w-16',
  lg: 'h-52 w-52',
};

const ILLUSTRATION_SIZE_PX: Record<IllustrationSize, number> = {
  sm: 56,
  md: 64,
  lg: 208,
};

interface WordIllustrationProps {
  categorySlug: string;
  word: string;
  /**
   * Картинка, загруженная админом (/uploads/word-images/<guid>.webp).
   *
   * Приоритетнее статической иллюстрации: если человек загрузил фото, значит
   * оно и должно показываться. Статическая остаётся фолбэком для слов, к
   * которым фото нет.
   */
  imageUrl?: string | null;
  /** Перевод попадает в alt: подпись к картинке читается как «слово — перевод». */
  translation?: string;
  /** Явный alt, если контекст требует своей формулировки. Пустым быть не может. */
  alt?: string;
  size?: IllustrationSize;
  /** Карточка флэшкарты берёт картинку без белого тайла и сама задаёт ей размер. */
  variant?: IllustrationVariant;
  /** Текущее слово грузим сразу: оно уже в первом экране и не должно мигать. */
  priority?: boolean;
  className?: string;
  /**
   * Пустой слот того же размера вместо null. Нужен только для приёмки вёрстки,
   * пока картинок нет; в интерфейсе не используется.
   */
  placeholder?: boolean;
}

/**
 * Иллюстрация слова из статических ассетов. Манифест — единственный источник
 * правды: пока файла нет, компонент не рендерит <img> вообще. Иначе браузер
 * запросил бы несуществующий .webp, и экран получил бы битую картинку с 404
 * в консоли — при нуле иллюстраций интерфейс должен выглядеть как раньше.
 *
 * onError страхует случай, когда файл удалили, а манифест пересобрать забыли:
 * запрос всё равно вернёт 404, но битой иконки в строке не останется — тайл
 * исчезает, как только браузер сообщил, что картинку не загрузить.
 */
export default function WordIllustration({
  categorySlug,
  word,
  imageUrl,
  translation,
  alt,
  size = 'md',
  variant = 'tile',
  priority = false,
  className = '',
  placeholder = false,
}: WordIllustrationProps) {
  const sizeClass = ILLUSTRATION_SIZE_CLASS[size];
  // Загруженное админом фото важнее статической иллюстрации: оно появилось
  // позже и осознанно. Статическая остаётся на случай, когда фото нет.
  const customSrc = imageUrl ? uploadedImageSrc(imageUrl) : null;
  const src = customSrc ?? illustrationSrc(categorySlug, word);
  // Ошибка привязана к src, а не к экземпляру: в флэшкартах один и тот же
  // компонент переиспользуется для следующего слова, и старый сбой не должен
  // прятать уже существующую картинку.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  const available = customSrc ? true : hasIllustration(categorySlug, word);

  if (!available || failed) {
    if (!placeholder) return null;
    return (
      <span
        aria-hidden="true"
        className={`inline-block shrink-0 rounded-lg border border-dashed border-hairline-strong bg-surface-sunken ${sizeClass} ${className}`.trim()}
      />
    );
  }

  // alt не бывает пустым: картинка несёт смысл слова, а не украшает строку,
  // поэтому при отсутствии явного alt собираем его из слова и перевода.
  const label =
    alt ?? (translation ? `Иллюстрация: ${word} — ${translation}` : `Иллюстрация: ${word}`);
  const px = ILLUSTRATION_SIZE_PX[size];

  if (variant === 'bare') {
    return (
      // bare нужен бумажной карточке: белый тайл там читался бы прямоугольником,
      // а масштаб задаёт родитель. Белый фон WebP растворяется через blend-mode.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={label}
        width={px}
        height={px}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className={`word-illustration-img h-full w-full object-contain ${className}`.trim()}
      />
    );
  }

  return (
    // Размер и скругление задаёт обёртка, а не сам <img>: у object-contain
    // остаются поля, и они должны быть бумажными, а не прозрачными.
    <span
      className={`word-illustration-tile inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-illustration-paper ${sizeClass} ${className}`.trim()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
        className="word-illustration-img h-full w-full object-contain"
      />
    </span>
  );
}
