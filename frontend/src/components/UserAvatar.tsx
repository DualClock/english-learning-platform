import { resolveAvatarSrc } from '@/app/lib/avatars';
import { frameLabel, normalizeFrame, type AvatarFrame } from '@/lib/customization';

interface Props {
  avatarUrl?: string | null;
  name?: string | null;
  frame?: string | null;
  className?: string;
}

const FRAME_CLASS: Record<AvatarFrame, string> = {
  none: '',
  paper: 'avatar-frame-paper p-[3px]',
  teal: 'avatar-frame-teal p-[3px]',
  ink: 'avatar-frame-ink p-[3px]',
  gold: 'avatar-frame-gold p-[3px]',
};

/**
 * Единственная точка аватара с рамкой. Рамка — внешнее кольцо, внутри
 * проходит тонкая полоса canvas, чтобы лицо не сливалось с декором.
 */
export default function UserAvatar({
  avatarUrl,
  name,
  frame,
  className = 'h-10 w-10',
}: Props) {
  const normalized = normalizeFrame(frame);

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${FRAME_CLASS[normalized]} ${className}`.trim()}
      title={frameLabel(normalized)}
    >
      <span
        className={`h-full w-full overflow-hidden rounded-full bg-canvas ${
          normalized === 'none' ? '' : 'p-[2px]'
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolveAvatarSrc(avatarUrl)}
          alt={name ? `Аватар ${name}` : 'Аватар'}
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
        />
      </span>
    </span>
  );
}
