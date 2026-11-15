<template>
  <LegalMentionsContent :lang="lang" />
</template>

<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { LegalMentionsContent, type OlydorLang } from '@olydor/ui'
import { useArenaI18n } from '../utils/i18n'

const injectedLang = inject<Ref<OlydorLang> | undefined>('olydorLang', undefined)
const { t, lang } = useArenaI18n(() => injectedLang?.value)

useSeoMeta({
  title: () => t('legalMentionsSeoTitle'),
  description: () => t('legalMentionsSeoDesc'),
  robots: 'index, follow',
})
</script>
