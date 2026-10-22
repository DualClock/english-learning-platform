export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'lexicon-theme';
export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

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
  const dark = isDark(mode);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  // Цвет адресной строки на телефоне идёт за темой, а не остаётся teal
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.setAttribute('content', dark ? '#0A1A2F' : '#0E7C7B');
  }
}

/**
 * Скрипт до первой отрисовки (вставляется в <head> корневого layout): без него
 * тёмная тема мигает светлым кадром, пока гидратируется React. Светлая — базовая,
 * поэтому отсутствие сохранённого выбора даёт её без обращения к системе.
 */
export const THEME_PREPAINT_SCRIPT =
  `try{var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `document.documentElement.dataset.theme=m==='dark'?'dark':'light';}catch(e){` +
  `document.documentElement.dataset.theme='light';}`;
