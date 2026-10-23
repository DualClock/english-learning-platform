import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        "primary-pressed": "var(--color-primary-pressed)",
        "primary-deep": "var(--color-primary-deep)",
        navy: "var(--color-navy)",
        "navy-deep": "var(--color-navy-deep)",
        link: "var(--color-link)",
        canvas: "var(--color-canvas)",
        "ground-warm": "var(--color-ground-warm)",
        scrim: "var(--color-scrim)",
        hairline: "var(--color-hairline)",
        "hairline-soft": "var(--color-hairline-soft)",
        "hairline-strong": "var(--color-hairline-strong)",
        ink: "var(--color-ink)",
        "ink-deep": "var(--color-ink-deep)",
        charcoal: "var(--color-charcoal)",
        slate: "var(--color-slate)",
        steel: "var(--color-steel)",
        muted: "var(--color-muted)",
        "on-dark": "var(--color-on-dark)",
        "on-dark-muted": "var(--color-on-dark-muted)",
        tint: {
          peach: "var(--color-tint-peach)",
          rose: "var(--color-tint-rose)",
          mint: "var(--color-tint-mint)",
          lavender: "var(--color-tint-lavender)",
          sky: "var(--color-tint-sky)",
          yellow: "var(--color-tint-yellow)",
          "yellow-bold": "var(--color-tint-yellow-bold)",
          teal: "var(--color-tint-teal)",
        },
        lexi: {
          paper: "var(--color-lexi-paper)",
          fold: "var(--color-lexi-fold)",
          line: "var(--color-lexi-line)",
          blush: "var(--color-lexi-blush)",
          accent: "var(--color-lexi-accent)",
        },
        semantic: {
          success: "var(--color-success)",
          warning: "var(--color-warning)",
          error: "var(--color-error)",
        },
        /* Семантические поверхности: цвет карточки означает статус/роль, а не декор */
        surface: {
          DEFAULT: "var(--color-surface)",
          soft: "var(--color-surface-soft)",
          info: "var(--surface-info)",
          success: "var(--surface-success)",
          warning: "var(--surface-warning)",
          danger: "var(--surface-danger)",
          accent: "var(--surface-accent)",
          decor: "var(--surface-decor)",
          highlight: "var(--surface-highlight)",
          sunken: "var(--surface-sunken)",
          inverse: "var(--surface-inverse)",
        },
        on: {
          info: "var(--on-info)",
          success: "var(--on-success)",
          warning: "var(--on-warning)",
          danger: "var(--on-danger)",
          accent: "var(--on-accent)",
          decor: "var(--on-decor)",
          primary: "var(--on-primary)",
        },
      },
      fontSize: {
        /* Шкала типографики. Пять рабочих размеров; caption — пол (13px). */
        hero: ["clamp(2.75rem, 7vw, 5.75rem)", { lineHeight: "0.98", letterSpacing: "-0.035em", fontWeight: "700" }],
        display: ["clamp(2.75rem, 8.5vw, 6.5rem)", { lineHeight: "0.92", letterSpacing: "-0.04em", fontWeight: "700" }],
        h1: ["clamp(1.75rem, 3.2vw, 2.75rem)", { lineHeight: "1.12", letterSpacing: "-0.025em", fontWeight: "600" }],
        h2: ["1.3125rem", { lineHeight: "1.3", letterSpacing: "-0.015em", fontWeight: "600" }],
        h3: ["1.0625rem", { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-lg": ["1.0625rem", { lineHeight: "1.6" }],
        body: ["1rem", { lineHeight: "1.6" }],
        "body-sm": ["0.9375rem", { lineHeight: "1.55" }],
        caption: ["0.8125rem", { lineHeight: "1.45", letterSpacing: "0.005em" }],
        mono: ["0.875rem", { lineHeight: "1.5" }],
        /* Шкала читалки: значения приходят из настроек чтения (--reader-*) */
        reading: ["var(--reader-size, 1.25rem)", { lineHeight: "var(--reader-leading, 1.8)" }],
        "reading-ui": ["var(--reader-ui-size, 0.9375rem)", { lineHeight: "1.5" }],
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['var(--font-manrope)', 'Inter', 'system-ui', 'sans-serif'],
        reading: ['var(--font-literata)', 'Literata', 'Georgia', 'Cambria', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
      scale: {
        '97': '0.97',
      },
      transitionDuration: {
        tap: "var(--duration-tap)",
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        soft: "var(--ease-out-soft)",
      },
      aspectRatio: {
        book: "3 / 4",
        wide: "16 / 9",
      },
      maxWidth: {
        /* Ширина набора: 42ch — подпись и statements, 68ch — интерфейс, 76ch — читалка */
        'measure-sm': "42ch",
        measure: "68ch",
        reading: "76ch",
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(15, 15, 15, 0.04)',
        'card': '0 4px 12px rgba(15, 15, 15, 0.08)',
        'modal': '0 16px 48px -8px rgba(15, 15, 15, 0.16)',
      },
    },
  },
  plugins: [],
};
export default config;
