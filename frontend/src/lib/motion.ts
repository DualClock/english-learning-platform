/**
 * Единый слой анимации. Тайминги и пружины живут только здесь —
 * в компонентах используются эти пресеты, а не литералы.
 * Длительности в секундах (API Motion); CSS-двойники — в globals.css (--duration-*).
 *
 * Reduced motion обрабатывается глобально через <MotionConfig reducedMotion="user">:
 * transform- и layout-анимации отключаются самим движком, opacity-переходы остаются.
 * Там, где нужен ручной контроль, — `fadeOnly`.
 */
export const duration = {
  tap: 0.12,
  fast: 0.18,
  base: 0.26,
  slow: 0.42,
  entrance: 0.45,
  page: 0.3,
} as const;

export const ease = {
  soft: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.4, 0, 0.2, 1] as [number, number, number, number],
  linear: 'linear' as const,
};

export const transition = {
  /** Отклик контрола: нажатие, фокус, смена состояния */
  tap: { duration: duration.tap, ease: ease.soft },
  /** Hover/focus-переходы, смена цвета, чекбоксы */
  fast: { duration: duration.fast, ease: ease.soft },
  /** Раскрытие секций, смена таба */
  base: { duration: duration.base, ease: ease.soft },
  /** Прогресс, счётчики, смена периода */
  slow: { duration: duration.slow, ease: ease.soft },
  /** Вход блока на экран */
  enter: { duration: duration.entrance, ease: ease.soft },
  /** Отзыв на верный ответ: лёгкий перелёт */
  correct: { type: 'spring' as const, duration: 0.5, bounce: 0.4 },
  /** Отзыв на ошибку: короткий, без перелёта */
  wrong: { type: 'spring' as const, duration: 0.4, bounce: 0.18 },
  /** Жестовое перетаскивание и бросок */
  momentum: { type: 'spring' as const, duration: 0.7, bounce: 0.2 },
};

export const tapScale = 0.97;

export const variants = {
  /** Появление блока снизу вверх (один вход на экран, не на каждый элемент) */
  enter: {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: transition.enter },
    exit: { opacity: 0, y: -8, transition: transition.fast },
  },
  /** Контейнер списка: stagger детей, ограничение суммарной задержки на первом экране */
  list: {
    hidden: {},
    visible: {
      transition: { delayChildren: 0.04, staggerChildren: 0.05 },
    },
    exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
  },
  /** Элемент списка внутри `list` */
  item: {
    hidden: { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: transition.base },
    exit: { opacity: 0, x: -12, transition: transition.fast },
  },
  /** Оверлей поверх контента (диалог, карточка слова) */
  overlay: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: transition.fast },
    exit: { opacity: 0, transition: transition.fast },
  },
  /** Панель снизу (настройки читалки, конспект) */
  sheet: {
    hidden: { opacity: 0, y: '100%' },
    visible: { opacity: 1, y: 0, transition: transition.base },
    exit: { opacity: 0, y: '100%', transition: transition.fast },
  },
  /** Переворот карточки quiz: known/unknown */
  feedbackCorrect: {
    hidden: { opacity: 0, scale: 0.94 },
    visible: { opacity: 1, scale: 1, transition: transition.correct },
  },
  feedbackWrong: {
    hidden: { opacity: 0, scale: 0.98 },
    visible: { opacity: 1, scale: [1, 1.01, 1], transition: transition.wrong },
  },
  /** Ручная деградация: только прозрачность, без travel */
  fadeOnly: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: transition.base },
    exit: { opacity: 0, transition: transition.fast },
  },
};

/**
 * Смена страницы в читалке и вопроса в quiz: динамические variants по направлению.
 * `<AnimatePresence custom={dir}>` + `variants={slideVariants(dir)} custom={dir}`,
 * где dir = 1 (вперёд) или -1 (назад).
 */
export function slideVariants(direction: number) {
  const enter = direction > 0 ? 24 : -24;
  const leave = direction > 0 ? -24 : 24;
  return {
    hidden: { opacity: 0, x: enter },
    visible: { opacity: 1, x: 0, transition: transition.base },
    exit: { opacity: 0, x: leave, transition: transition.fast },
  };
}
