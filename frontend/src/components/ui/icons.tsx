import type { SVGProps } from 'react';

/**
 * Иконки интерфейса: один набор, inline SVG, stroke="currentColor",
 * оптический размер 16/20/24. Наследуют цвет текста, поэтому работают
 * в обеих темах без отдельных значений.
 */
export type IconSize = 16 | 20 | 24;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: IconSize;
  /** Иконка несёт смысл — тогда даём подпись вместо aria-hidden */
  label?: string;
}

function Icon({ size = 20, label, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {children}
    </svg>
  );
}

type P = IconProps;

/* Навигация */
export const HomeIcon = (p: P) => (
  <Icon {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></Icon>
);
export const MenuIcon = (p: P) => (
  <Icon {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Icon>
);
export const BooksIcon = (p: P) => (
  <Icon {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Icon>
);
export const LibraryIcon = (p: P) => (
  <Icon {...p}><path d="M12 2l10 5-10 5L2 7l10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></Icon>
);
export const BookOpenIcon = (p: P) => (
  <Icon {...p}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></Icon>
);
export const NotebookIcon = (p: P) => (
  <Icon {...p}><rect x="4" y="2" width="17" height="20" rx="2" /><path d="M8 2v20" /><path d="M1 6h3M1 10h3M1 14h3M1 18h3" /></Icon>
);
export const FoldersIcon = (p: P) => (
  <Icon {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><path d="M2 12h20" /></Icon>
);
export const RepeatIcon = (p: P) => (
  <Icon {...p}><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></Icon>
);
export const TrendUpIcon = (p: P) => (
  <Icon {...p}><path d="M23 6l-9.5 9.5-5-5L1 18" /><path d="M17 6h6v6" /></Icon>
);
export const TestIcon = (p: P) => (
  <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12l3 3 5-6" /></Icon>
);
export const HeadphonesIcon = (p: P) => (
  <Icon {...p}><path d="M3 18v-5a9 9 0 0 1 18 0v5" /><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" /></Icon>
);
export const MicIcon = (p: P) => (
  <Icon {...p}><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1" /><path d="M12 19v3" /></Icon>
);
export const SpeechIcon = (p: P) => (
  <Icon {...p}><path d="M21 12a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 8h6M8 11h4" /></Icon>
);
export const PenIcon = (p: P) => (
  <Icon {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Icon>
);
export const BotIcon = (p: P) => (
  <Icon {...p}><path d="M12 8V4H8" /><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M1 14h2M21 14h2M9 12v2M15 12v2" /></Icon>
);
export const SlidersIcon = (p: P) => (
  <Icon {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></Icon>
);

/* Обратная связь и статусы */
export const CheckIcon = (p: P) => <Icon {...p}><path d="M20 6L9 17l-5-5" /></Icon>;
export const CheckCircleIcon = (p: P) => (
  <Icon {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></Icon>
);
export const CloseIcon = (p: P) => <Icon {...p}><path d="M18 6L6 18M6 6l12 12" /></Icon>;
export const CloseCircleIcon = (p: P) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></Icon>
);
export const PlusIcon = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const AlertIcon = (p: P) => (
  <Icon {...p}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></Icon>
);
export const InfoIcon = (p: P) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></Icon>
);
export const InboxIcon = (p: P) => (
  <Icon {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></Icon>
);
export const FeedbackIcon = (p: P) => (
  <Icon {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    <path d="M8 10h8M8 14h5" />
  </Icon>
);
// Щит — пункт админки: обозначает «служебная зона», а не ещё один раздел учёбы.
export const ShieldIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);
export const SpinnerIcon = ({ className = '', ...p }: P) => (
  <Icon {...p} className={`animate-spin ${className.trim()}`}>
    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </Icon>
);

/* Действия и навигация внутри экранов */
export const ArrowLeftIcon = (p: P) => <Icon {...p}><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></Icon>;
export const ArrowRightIcon = (p: P) => <Icon {...p}><path d="M5 12h14" /><path d="M12 5l7 7-7 7" /></Icon>;
export const ChevronDownIcon = (p: P) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>;
export const ChevronRightIcon = (p: P) => <Icon {...p}><path d="M9 18l6-6-6-6" /></Icon>;
export const RefreshIcon = (p: P) => (
  <Icon {...p}><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></Icon>
);
export const SearchIcon = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></Icon>;
export const UploadIcon = (p: P) => (
  <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></Icon>
);
export const TrashIcon = (p: P) => (
  <Icon {...p}><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></Icon>
);
export const ClockIcon = (p: P) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Icon>
);
export const BookmarkIcon = (p: P) => (
  <Icon {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></Icon>
);
export const BookmarkFilledIcon = (p: P) => (
  <Icon {...p}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="currentColor" /></Icon>
);
export const StarIcon = (p: P) => (
  <Icon {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" /></Icon>
);
export const StarFilledIcon = (p: P) => (
  <Icon {...p}><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" fill="currentColor" /></Icon>
);
export const LogOutIcon = (p: P) => (
  <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></Icon>
);
export const UserIcon = (p: P) => (
  <Icon {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Icon>
);
export const LockIcon = (p: P) => (
  <Icon {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon>
);
export const PlayIcon = (p: P) => <Icon {...p}><path d="M6 4l14 8-14 8z" fill="currentColor" /></Icon>;
export const PauseIcon = (p: P) => <Icon {...p}><path d="M7 4v16M17 4v16" /></Icon>;
export const StopIcon = (p: P) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></Icon>;

/* Звук */
export const VolumeIcon = (p: P) => (
  <Icon {...p}><path d="M11 5L6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" /></Icon>
);
export const VolumeOffIcon = (p: P) => (
  <Icon {...p}><path d="M11 5L6 9H2v6h4l5 4z" /><path d="M22 9l-6 6M16 9l6 6" /></Icon>
);

/* Достижения, метки, акценты */
export const SparkIcon = (p: P) => (
  <Icon {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></Icon>
);
export const SparklesIcon = (p: P) => (
  <Icon {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></Icon>
);
export const FlameIcon = (p: P) => (
  <Icon {...p}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></Icon>
);
export const TargetIcon = (p: P) => (
  <Icon {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Icon>
);
export const TrophyIcon = (p: P) => (
  <Icon {...p}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21 1.18.54 2.03 2.03 2.03 3.79" /><path d="M18 2H6v7a6 6 0 0 0 12 0z" /></Icon>
);
export const MedalIcon = (p: P) => (
  <Icon {...p}><circle cx="12" cy="8" r="6" /><path d="M15.48 12.89L17 22l-5-3-5 3 1.52-9.11" /></Icon>
);
export const GemIcon = (p: P) => (
  <Icon {...p}><path d="M6 3h12l4 6-10 12L2 9z" /><path d="M2 9h20" /><path d="M9 9l3 12 3-12" /></Icon>
);
export const BulbIcon = (p: P) => (
  <Icon {...p}><path d="M9 18h6M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" /></Icon>
);
export const PinIcon = (p: P) => (
  <Icon {...p}><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></Icon>
);
export const ChartIcon = (p: P) => (
  <Icon {...p}><path d="M3 3v18h18" /><path d="M7 15v3M12 10v8M17 6v12" /></Icon>
);
export const RocketIcon = (p: P) => (
  <Icon {...p}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></Icon>
);
export const BriefcaseIcon = (p: P) => (
  <Icon {...p}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></Icon>
);
export const PlaneIcon = (p: P) => (
  <Icon {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></Icon>
);
export const FilmIcon = (p: P) => (
  <Icon {...p}><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" /></Icon>
);

/* Темы словаря: подписываются по ключевым словам категории вместо эмодзи из API */
export const SmileIcon = (p: P) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" /></Icon>
);
export const UtensilsIcon = (p: P) => (
  <Icon {...p}><path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></Icon>
);
export const LeafIcon = (p: P) => (
  <Icon {...p}><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></Icon>
);
export const BagIcon = (p: P) => (
  <Icon {...p}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></Icon>
);
export const HeartIcon = (p: P) => (
  <Icon {...p}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z" /></Icon>
);
export const ChipIcon = (p: P) => (
  <Icon {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" /></Icon>
);

/* Почта и письмо подтверждения */
export const MailIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </Icon>
);

/* Отправка сообщения */
export const SendIcon = (p: P) => (
  <Icon {...p}>
    <path d="M21.5 2.5 11 13" />
    <path d="M21.5 2.5 15 21l-4-8-8-4Z" />
  </Icon>
);
