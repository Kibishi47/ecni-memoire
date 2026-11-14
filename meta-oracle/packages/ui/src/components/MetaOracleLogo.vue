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
        <linearGradient id="a" x1="42" y1="224" x2="218" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#b8297e" />
          <stop offset="18%" stop-color="#e83845" />
          <stop offset="42%" stop-color="#ff5e00" />
          <stop offset="72%" stop-color="#f80" />
          <stop offset="100%" stop-color="#ffc414" />
        </linearGradient>
        <linearGradient id="b" x1="64" y1="216" x2="184" y2="196" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#b8297e" />
          <stop offset="45%" stop-color="#e83845" />
          <stop offset="100%" stop-color="#f70" />
        </linearGradient>
      </defs>
      <path d="m66 68-25 9c-3 1-4 4-3 7l28 93" stroke="url(#a)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="m71 196 4 12c1 3 4 4 7 3l32-13" stroke="url(#b)" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M88 60V30l40 59 40-59v30" stroke="url(#a)" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M66 183V49l62 40 62-40v89a52 52 0 0 1-104 0V92" stroke="url(#a)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M66 183v4l20-5v-36" stroke="url(#a)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M170 92v30" stroke="url(#a)" stroke-width="7.5" stroke-linecap="round" />
      <path d="M94 132c16-27 52-27 70 0-18 27-54 27-70 0Z" stroke="url(#a)" stroke-width="7" stroke-linejoin="round" />
      <circle cx="129" cy="132" r="14.5" stroke="url(#a)" stroke-width="6.5" />
      <circle cx="134" cy="127" r="4.5" fill="url(#a)" />
      <path d="M190 58c32 6 34 40-22 76" stroke="url(#a)" stroke-width="7" stroke-linecap="round" />
      <circle cx="168" cy="134" r="6" fill="url(#a)" />
      <path d="M52 135c-18 27-10 57 34 49 30-5 54-18 76-33" stroke="url(#a)" stroke-width="7" stroke-linecap="round" />
      <circle cx="162" cy="151" r="6" fill="url(#a)" />
      <path d="M191 77c15 13 23 31 25 52" stroke="url(#a)" stroke-width="6.5" stroke-linecap="round" />
      <circle cx="216" cy="129" r="6.5" fill="url(#a)" />
      <path d="M215 143c-2 19-9 35-19 48" stroke="url(#a)" stroke-width="6.5" stroke-linecap="round" />
      <circle cx="187" cy="201" r="6" fill="url(#a)" />
      <path d="M178 209c-24 16-60 16-83-2" stroke="url(#b)" stroke-width="6.5" stroke-linecap="round" />
    </svg>

    <span v-if="showText" class="flex flex-col leading-none">
      <span
        :class="textSizeClass"
        class="font-black tracking-wider uppercase mo-gradient-text"
      >
        META ORACLE
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

export interface MetaOracleLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | number
  showText?: boolean
  subtitle?: string
}

const props = withDefaults(defineProps<MetaOracleLogoProps>(), {
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
