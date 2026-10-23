import { NotebookIcon } from '@/components/ui/icons';
import { resolveWordImageSrc } from '@/lib/wordVisuals';

type VisualSize = 'sm' | 'md' | 'lg';

interface WordVisualProps {
  word: string;
  emoji?: string | null;
  imageUrl?: string | null;
  fallbackEmoji?: string | null;
  size?: VisualSize;
  className?: string;
}

const SIZE_CLASS: Record<VisualSize, string> = {
  sm: 'h-11 w-11',
  md: 'h-14 w-14',
  lg: 'h-24 w-24',
};

const EMOJI_CLASS: Record<VisualSize, string> = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-4xl',
};

/**
 * Личный визуал слова с безопасным fallback: если картинки и эмодзи нет,
 * остаётся нейтральная иконка словаря. Загруженная картинка идёт через
 * приватный /api/word-image, поэтому чужие файлы не видны.
 */
export default function WordVisual({
  word,
  emoji,
  imageUrl,
  fallbackEmoji,
  size = 'md',
  className = '',
}: WordVisualProps) {
  const imageSrc = resolveWordImageSrc(imageUrl);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-hairline bg-surface-sunken text-slate ${SIZE_CLASS[size]} ${className}`.trim()}
    >
      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt={`Изображение для слова «${word}»`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : emoji ? (
        <span role="img" aria-label={`Эмодзи для слова «${word}»`} className={EMOJI_CLASS[size]}>
          {emoji}
        </span>
      ) : fallbackEmoji ? (
        <span aria-hidden="true" className={EMOJI_CLASS[size]}>
          {fallbackEmoji}
        </span>
      ) : (
        <NotebookIcon size={size === 'sm' ? 20 : 24} />
      )}
    </span>
  );
}
