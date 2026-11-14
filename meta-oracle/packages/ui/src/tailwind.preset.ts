import type { Config } from 'tailwindcss'

export const metaOracleTailwindPreset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          canvas: '#0c0f16',
          surface: '#131823',
          elevated: '#1b2232',
          border: '#263044',
        },
        solar: {
          crimson: '#e11d48',
          primary: '#ff6b00',
          amber: '#ff8a00',
          gold: '#ffc21a',
        },
        mo: {
          canvas: 'var(--bg-canvas)',
          surface: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
          border: 'var(--border-subtle)',
          crimson: 'var(--brand-crimson)',
          primary: 'var(--brand-primary)',
          amber: 'var(--brand-amber)',
          gold: 'var(--brand-gold)',
          'text-primary': 'var(--text-primary)',
          'text-secondary': 'var(--text-secondary)',
          'text-muted': 'var(--text-muted)',
          positive: 'var(--status-positive)',
          warning: 'var(--status-warning)',
          negative: 'var(--status-negative)',
          ai: 'var(--ai-accent)',
        },
      },
      boxShadow: {
        'brand-glow': '0 0 24px rgba(255, 107, 0, 0.25)',
        'brand-glow-lg': '0 0 36px rgba(255, 107, 0, 0.35)',
        'ai-glow': '0 0 24px rgba(56, 189, 248, 0.22)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #e11d48 0%, #ff5500 45%, #ffc21a 100%)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
}

export default metaOracleTailwindPreset
