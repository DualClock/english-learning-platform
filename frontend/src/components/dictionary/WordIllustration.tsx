'use client';

import { useState } from 'react';
import { hasIllustration, illustrationSrc } from '@/lib/wordIllustrations.generated';

type IllustrationSize = 'sm' | 'md' | 'lg';

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
  /** Перевод попадает в alt: подпись к картинке читается как «слово — перевод». */
  translation?: string;
  /** Явный alt, если контекст требует своей формулировки. Пустым быть не может. */
  alt?: string;
  size?: IllustrationSize;
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
  translation,
  alt,
  size = 'md',
  className = '',
  placeholder = false,
}: WordIllustrationProps) {
  const sizeClass = ILLUSTRATION_SIZE_CLASS[size];
  const src = illustrationSrc(categorySlug, word);
  // Ошибка привязана к src, а не к экземпляру: в флэшкартах один и тот же
  // компонент переиспользуется для следующего слова, и старый сбой не должен
  // прятать уже существующую картинку.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (!hasIllustration(categorySlug, word) || failed) {
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
