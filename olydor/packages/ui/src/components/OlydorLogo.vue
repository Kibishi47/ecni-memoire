<template>
  <span class="inline-flex items-center gap-2.5 select-none">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="none"
      :width="pixelSize"
      :height="pixelSize"
      class="shrink-0 drop-shadow-[0_0_12px_rgba(255,107,0,0.35)]"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="a" x1="36" y1="216" x2="220" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#b8297e" />
          <stop offset="20%" stop-color="#e83845" />
          <stop offset="48%" stop-color="#ff5e00" />
          <stop offset="76%" stop-color="#f80" />
          <stop offset="100%" stop-color="#ffc414" />
        </linearGradient>
      </defs>
      <path d="m63 91-23 18q-6 4.5-1.5 10.5l36.6 48.8q3.9 5.2 9.1 1.3l.8-3.6" stroke="url(#a)" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="m193 91 23 18q6 4.5 1.5 10.5l-36.6 48.8q-3.9 5.2-9.1 1.3l-.8-3.6" stroke="url(#a)" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M99 53 62 72q-7 4-3 11l19 37" stroke="url(#a)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="m157 53 37 19q7 4 3 11l-19 37" stroke="url(#a)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M99 94V50a8 8 0 0 1 8-8h42a8 8 0 0 1 8 8v44" stroke="url(#a)" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="128" cy="138" r="52" stroke="url(#a)" stroke-width="8.5" />
      <path d="M93 138c16-25 54-25 70 0-16 25-54 25-70 0Z" stroke="url(#a)" stroke-width="7" stroke-linejoin="round" />
      <circle cx="128" cy="138" r="14" stroke="url(#a)" stroke-width="6.5" />
      <circle cx="133" cy="133" r="4" fill="url(#a)" />
    </svg>

    <span v-if="showText" class="flex flex-col leading-none">
      <span
        :class="textSizeClass"
        class="font-black tracking-wider uppercase mo-gradient-text"
      >
        OLYDOR
      </span>
      <span
        v-if="subtitle"
        class="text-[10px] font-medium tracking-widest uppercase mt-0.5"
        style="color: var(--text-secondary)"
      >
        {{ subtitle }}
      </span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export interface OlydorLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | number
  showText?: boolean
  subtitle?: string
}

const props = withDefaults(defineProps<OlydorLogoProps>(), {
  size: 'md',
  showText: true,
  subtitle: '',
})

const pixelSize = computed(() => {
  if (typeof props.size === 'number') return props.size
  switch (props.size) {
    case 'sm':
      return 28
    case 'lg':
      return 52
    case 'xl':
      return 76
    case 'md':
    default:
      return 36
  }
})

const textSizeClass = computed(() => {
  if (typeof props.size === 'number') {
    if (props.size >= 64) return 'text-2xl sm:text-3xl'
    if (props.size >= 44) return 'text-xl'
    return 'text-base'
  }
  switch (props.size) {
    case 'sm':
      return 'text-sm'
    case 'lg':
      return 'text-xl'
    case 'xl':
      return 'text-2xl sm:text-3xl'
    case 'md':
    default:
      return 'text-base sm:text-lg'
  }
})
</script>
