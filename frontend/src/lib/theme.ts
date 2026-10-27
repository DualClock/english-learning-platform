export type ThemeMode = 'light' | 'dark';

export type AccentTheme = 'teal' | 'warm' | 'ink';

export const THEME_STORAGE_KEY = 'lexicon-theme';
export const ACCENT_STORAGE_KEY = 'lexicon-accent';
export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

/**
 * Акцент — второй слой оформления: он меняет только рабочий акцент и его
 * мягкие поверхности, а светлая/тёмная тема остаются независимыми.
 * Светокарты — для живого предпросмотра в настройках.
 */
export const ACCENT_THEMES: {
  value: AccentTheme;
  label: string;
  description: string;
  swatch: {
    light: { primary: string; soft: string; onSoft: string };
    dark: { primary: string; soft: string; onSoft: string };
  };
}[] = [
  {
    value: 'teal',
    label: 'Морской',
    description: 'Тихий teal Lexicon — базовый',
    swatch: {
      light: { primary: '#0E7C7B', soft: '#D6EFEE', onSoft: '#0A6362' },
      dark: { primary: '#2FB0A8', soft: '#0F3534', onSoft: '#7FDCD5' },
    },
  },
  {
    value: 'warm',
    label: 'Тёплый',
    description: 'Терракота и бумага',
    swatch: {
      light: { primary: '#A84F2A', soft: '#FCE8D7', onSoft: '#7A3416' },
      dark: { primary: '#E0A06A', soft: '#33221A', onSoft: '#F1C39D' },
    },
  },
  {
    value: 'ink',
    label: 'Чернильный',
    description: 'Глубокий синий и графит',
    swatch: {
      light: { primary: '#3E4E8D', soft: '#E4E8F6', onSoft: '#2E3B66' },
      dark: { primary: '#9FB2E8', soft: '#1C2540', onSoft: '#C4D1F4' },
    },
  },
];

export function normalizeAccent(value?: string | null): AccentTheme {
  return value === 'warm' || value === 'ink' ? value : 'teal';
}

export function readAccent(): AccentTheme {
  try {
    return normalizeAccent(window.localStorage.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return 'teal';
  }
}

export function writeAccent(accent: AccentTheme): void {
  try {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // без хранилища акцент работает до перезагрузки
  }
}

export function isDark(mode: ThemeMode): boolean {
  return mode === 'dark';
}

/**
 * Базовая тема — светлая. Системная настройка больше не участвует:
 * сохранённый «system» (или мусор в хранилище) читается как светлая.
 */
export function readTheme(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    // приватный режим браузера: тема работает до перезагрузки страницы
    return 'light';
  }
}

export function writeTheme(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* хранилища нет — не роняем переключение */
  }
}

/**
 * Тема — один признак на <html>: все поверхности в globals.css описаны
 * токенами, поэтому компонентам не нужны dark:-варианты.
 *
 * data-theme, а не класс: React при гидрации сверяет className, а скрипт
 * до первой отрисовки всегда успевает поменять <html> — на классе каждый
 * экран давал «Prop className did not match».
 */
export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = isDark(mode) ? 'dark' : 'light';
  syncThemeColor();
}

/** Применяет акцент без сохранения: используется при входе и после «Применить». */
export function applyAccent(accent: AccentTheme) {
  document.documentElement.dataset.accent = normalizeAccent(accent);
  syncThemeColor();
}

/**
 * Цвет адресной строки на телефоне идёт за темой, а в светлой — за акцентом.
 * В тёмной оставляем глубокий navy: он читается как фон приложения.
 */
export function syncThemeColor() {
  const root = document.documentElement;
  const dark = root.dataset.theme === 'dark';
  const primary = getComputedStyle(root).getPropertyValue('--color-primary').trim();
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute('content', dark ? '#0A1A2F' : primary || '#0E7C7B');
  }
}

/**
 * Скрипт до первой отрисовки (вставляется в <head> корневого layout): без него
 * тёмная тема мигает светлым кадром, пока гидратируется React. Светлая — базовая,
 * поэтому отсутствие сохранённого выбора даёт её без обращения к системе.
 */
export const THEME_PREPAINT_SCRIPT =
  `try{var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `document.documentElement.dataset.theme=m==='dark'?'dark':'light';` +
  `var a=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});` +
  `document.documentElement.dataset.accent=(a==='warm'||a==='ink')?a:'teal';}catch(e){` +
  `document.documentElement.dataset.theme='light';` +
  `document.documentElement.dataset.accent='teal';}`;
