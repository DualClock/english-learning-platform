import type { IconProps, IconSize } from '@/components/ui/icons';
import {
  BookOpenIcon,
  BookmarkIcon,
  BulbIcon,
  ChartIcon,
  FoldersIcon,
  HeadphonesIcon,
  NotebookIcon,
  PenIcon,
  RepeatIcon,
  RocketIcon,
  SpeechIcon,
  TargetIcon,
  TrendUpIcon,
} from '@/components/ui/icons';

/*
 * Backend присылает в achievement.icon эмодзи. Мы его не рисуем: набор
 * собственных иконок один на всё приложение, а код достижения — то, что
 * реально приходит в ответе. По подстроке новый ачивк не ломает экран —
 * останется нейтральная иконка вместо случайного смайла.
 */
const ACHIEVEMENT_ICONS: { match: RegExp; Icon: (p: IconProps) => JSX.Element }[] = [
  { match: /streak|fire|day/i, Icon: TrendUpIcon },
  { match: /word|vocab|dictionar/i, Icon: BookmarkIcon },
  { match: /bulk|batch|list/i, Icon: FoldersIcon },
  { match: /book|read|page|librar/i, Icon: BookOpenIcon },
  { match: /grammar/i, Icon: NotebookIcon },
  { match: /categor/i, Icon: FoldersIcon },
  { match: /review|repeat/i, Icon: RepeatIcon },
  { match: /listen|dictation|pronunci|sound/i, Icon: HeadphonesIcon },
  { match: /translat|speech|talk/i, Icon: SpeechIcon },
  { match: /writ|essay/i, Icon: PenIcon },
  { match: /quiz|test|perfect|score/i, Icon: TargetIcon },
  { match: /xp|level/i, Icon: ChartIcon },
  { match: /first|start|launch/i, Icon: RocketIcon },
];

/** Иконка достижения по коду: общая для профиля и страницы прогресса. */
export default function AchievementIcon({
  code,
  size = 20,
}: {
  code: string;
  size?: IconSize;
}) {
  const found = ACHIEVEMENT_ICONS.find((entry) => entry.match.test(code));
  const Icon = found ? found.Icon : BulbIcon;
  return <Icon size={size} />;
}
