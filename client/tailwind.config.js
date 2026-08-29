/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        gray: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      /*
       * Échelle typographique relevée d'un cran.
       *
       * L'application comptait 716 `text-sm` et 424 `text-xs` pour seulement
       * 5 `text-base` : l'essentiel du texte était à 12 ou 14 px, illisible
       * en plein soleil pour un agent de terrain. Remapper l'échelle ici
       * corrige les 1 140 occurrences d'un coup, sans toucher au balisage.
       */
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],   // 14 px (était 12)
        sm: ['0.9375rem', { lineHeight: '1.5rem' }],   // 15 px (était 14)
        base: ['1.0625rem', { lineHeight: '1.625rem' }], // 17 px (était 16)
      },
      boxShadow: {
        'soft': '0 2px 10px rgba(0, 0, 0, 0.03)',
        'medium': '0 4px 20px rgba(0, 0, 0, 0.05)',
        'hard': '0 8px 30px rgba(0, 0, 0, 0.08)',
      }
    },
  },
  plugins: [],
}
