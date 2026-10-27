import type { ComponentType } from 'react';
import {
  BagIcon,
  BookOpenIcon,
  BriefcaseIcon,
  ChipIcon,
  FilmIcon,
  HeadphonesIcon,
  HeartIcon,
  HomeIcon,
  LeafIcon,
  NotebookIcon,
  PlaneIcon,
  SmileIcon,
  TargetIcon,
  TrendUpIcon,
  UtensilsIcon,
  type IconProps,
} from '@/components/ui/icons';

/**
 * Иконка темы по ключевым словам slug и названия.
 *
 * Категории приходят из API с полем `icon` — там эмодзи. Как глиф интерфейса
 * он не используется: эмодзи не наследует цвет темы и не масштабируется
 * с остальными иконками. Данные при этом остаются нетронутыми — подстановка
 * живёт на стороне UI.
 */
const TOPICS: { keys: RegExp; Icon: ComponentType<IconProps> }[] = [
  { keys: /(emotion|feeling|mood|эмоц|чувств|настроени)/i, Icon: SmileIcon },
  { keys: /(food|eat|cook|meal|еда|кухн|продукт|вкус)/i, Icon: UtensilsIcon },
  { keys: /(travel|trip|journey|airport|hotel|путешеств|аэропорт|отел|дорог)/i, Icon: PlaneIcon },
  { keys: /(work|job|career|office|profess|работа|професс|карьер|офис)/i, Icon: BriefcaseIcon },
  { keys: /(business|money|finance|bank|бизнес|деньг|финанс|банк)/i, Icon: TrendUpIcon },
  { keys: /(home|house|family|daily|быт|дом|семь|повседневн)/i, Icon: HomeIcon },
  { keys: /(study|school|university|lesson|учёб|учеб|школ|университет|образован)/i, Icon: NotebookIcon },
  { keys: /(nature|weather|animal|garden|природ|погод|животн|сад|лес)/i, Icon: LeafIcon },
  { keys: /(movie|film|cinema|art|music|кино|искусств|музык|театр)/i, Icon: FilmIcon },
  { keys: /(tech|computer|internet|gadget|техно|компьют|интернет|гаджет)/i, Icon: ChipIcon },
  { keys: /(health|body|medical|здоровь|тело|врач|медиц)/i, Icon: HeartIcon },
  { keys: /(shop|shopping|clothes|store|покупк|одежд|магазин)/i, Icon: BagIcon },
  { keys: /(sport|game|play|спорт|игр|тренировк)/i, Icon: TargetIcon },
  { keys: /(headphones|sound|звук|наушник)/i, Icon: HeadphonesIcon },
];

interface CategoryIconProps extends IconProps {
  slug?: string;
  name?: string;
}

export default function CategoryIcon({ slug = '', name = '', ...rest }: CategoryIconProps) {
  const haystack = `${slug} ${name}`;
  const match = TOPICS.find(({ keys }) => keys.test(haystack));
  const Icon = match?.Icon ?? BookOpenIcon;
  return <Icon {...rest} />;
}
