import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
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
        surface: "var(--color-surface)",
        "surface-soft": "var(--color-surface-soft)",
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
        },
        semantic: {
          success: "var(--color-success)",
          warning: "var(--color-warning)",
          error: "var(--color-error)",
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['var(--font-manrope)', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
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
