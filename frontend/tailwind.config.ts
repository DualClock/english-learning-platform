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
        background: "var(--background)",
        foreground: "var(--foreground)",
        cream: {
          50: '#F7F5EF',
          100: '#F0EDE5',
          200: '#E8E4DA',
        },
        charcoal: {
          900: '#20231F',
          800: '#2A2E29',
          700: '#353A34',
        },
        forest: {
          500: '#356B52',
          600: '#2D5A45',
          700: '#254A38',
        },
        golden: {
          400: '#EBCB75',
          500: '#D4AF37',
        },
        sage: {
          100: '#E7ECE4',
          200: '#D8DFD5',
        },
      },
      fontFamily: {
        sans: ['var(--font-manrope)', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'lg': '12px',
        'xl': '16px',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(32, 35, 31, 0.08)',
        'medium': '0 4px 16px rgba(32, 35, 31, 0.12)',
      },
    },
  },
  plugins: [],
};
export default config;
