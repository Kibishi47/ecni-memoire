/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        deckA: {
          light: '#38bdf8', // sky-400
          DEFAULT: '#0284c7', // sky-600
          dark: '#0369a1',
          bg: 'rgba(2, 132, 199, 0.1)',
          border: 'rgba(56, 189, 248, 0.3)'
        },
        deckB: {
          light: '#a78bfa', // violet-400
          DEFAULT: '#7c3aed', // violet-600
          dark: '#6d28d9',
          bg: 'rgba(124, 58, 237, 0.1)',
          border: 'rgba(167, 139, 250, 0.3)'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
