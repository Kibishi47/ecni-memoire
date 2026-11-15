<template>
  <LegalMentionsContent :lang="currentLang" />
</template>

<script setup lang="ts">
import { LegalMentionsContent } from '@olydor/ui'
import { useI18n } from '../utils/i18n'

const { t, currentLang } = useI18n()

useSeoMeta({
  title: () => t('legalMentionsSeoTitle'),
  description: () => t('legalMentionsSeoDesc'),
})
</script>
