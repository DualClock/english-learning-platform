export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'lexicon-theme';
export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
];

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function isDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark());
}

export function readTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    // приватный режим браузера: тема работает до перезагрузки страницы
    return 'system';
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
}

/**
 * Скрипт до первой отрисовки (вставляется в <head> корневого layout): без него
 * тёмная тема мигает светлым кадром, пока гидратируется React.
 */
export const THEME_PREPAINT_SCRIPT =
  `try{var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||'system';` +
  `var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);` +
  `document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}`;
