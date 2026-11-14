import type { Config } from 'tailwindcss'
import { metaOracleTailwindPreset } from '../../packages/ui/src/tailwind.preset'

export default {
  presets: [metaOracleTailwindPreset],
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './utils/**/*.ts',
    './app.vue',
    '../../packages/ui/src/**/*.{vue,ts}',
  ],
} satisfies Partial<Config>
