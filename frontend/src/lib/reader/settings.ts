import {
  DEFAULT_READER_SETTINGS,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MAX_MARGIN,
  MIN_FONT_SIZE,
  MIN_LINE_HEIGHT,
  MIN_MARGIN,
  READER_SETTINGS_KEY,
  type ReaderSettings,
  type ReaderTheme,
} from './types';

const THEMES: ReaderTheme[] = ['day', 'sepia', 'night'];

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function normalizeReaderSettings(value: Partial<ReaderSettings> | null | undefined): ReaderSettings {
  return {
    fontSize: clamp(Number(value?.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_READER_SETTINGS.fontSize),
    lineHeight: clamp(
      Number(value?.lineHeight),
      MIN_LINE_HEIGHT,
      MAX_LINE_HEIGHT,
      DEFAULT_READER_SETTINGS.lineHeight
    ),
    margin: clamp(Number(value?.margin), MIN_MARGIN, MAX_MARGIN, DEFAULT_READER_SETTINGS.margin),
    theme: THEMES.includes(value?.theme as ReaderTheme)
      ? (value!.theme as ReaderTheme)
      : DEFAULT_READER_SETTINGS.theme,
  };
}

export function loadReaderSettings(): ReaderSettings {
  if (typeof window === 'undefined') return DEFAULT_READER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(READER_SETTINGS_KEY);
    return raw ? normalizeReaderSettings(JSON.parse(raw) as Partial<ReaderSettings>) : DEFAULT_READER_SETTINGS;
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // настройки не переживут перезагрузку — чтение важнее
  }
}

export function readerLayoutKey(settings: ReaderSettings): string {
  return `${settings.fontSize}|${settings.lineHeight}|${settings.margin}`;
}
