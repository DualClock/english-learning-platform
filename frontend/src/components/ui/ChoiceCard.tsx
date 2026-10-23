'use client';

import { forwardRef, type KeyboardEventHandler } from 'react';
import { CheckIcon } from './icons';

/*
 * Вариант одиночного выбора: одна карточка на онбординг и на публичный тест
 * уровня (W2.2a). Рисунок обязан совпадать — «выбор» не должен выглядеть
 * по-разному в зависимости от того, пришёл человек с рекламы или из регистрации.
 *
 * По умолчанию это кнопка с aria-pressed (так онбординг жил до сих пор). Внутри
 * radiogroup на /test вариант обязан быть role="radio" с aria-checked: экранному
 * читателю нужно слышать «радиокнопка, выбрано», а не «кнопка нажата».
 */

interface ChoiceCardProps {
  selected: boolean;
  title: string;
  description?: string;
  onSelect: () => void;
  /** 'lg' — вариант теста уровня: текст крупнее, мимо пальцем не промахнуться */
  size?: 'md' | 'lg';
  /** true — карточка живёт в radiogroup и получает роль radio */
  asRadio?: boolean;
  id?: string;
  /** Roving tabindex для стрелочной навигации по группе */
  tabIndex?: number;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}

const ChoiceCard = forwardRef<HTMLButtonElement, ChoiceCardProps>(function ChoiceCard(
  { selected, title, description, onSelect, size = 'md', asRadio = false, id, tabIndex, onKeyDown },
  ref
) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      onClick={onSelect}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      role={asRadio ? 'radio' : undefined}
      aria-checked={asRadio ? selected : undefined}
      aria-pressed={asRadio ? undefined : selected}
      className={`flex w-full items-center gap-4 rounded-lg border p-5 text-left transition-[background-color,border-color] duration-fast ease-soft ${
        selected
          ? 'border-primary bg-surface-success'
          : 'border-hairline-strong bg-canvas hover:border-primary'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block font-medium text-ink ${size === 'lg' ? 'text-body-lg' : 'text-body'}`}>
          {title}
        </span>
        {description && <span className="mt-1 block text-body-sm text-slate">{description}</span>}
      </span>
      {selected && <CheckIcon size={20} className="shrink-0 text-primary" />}
    </button>
  );
});

export default ChoiceCard;
