<template>
  <TermsContent :lang="currentLang" />
</template>

<script setup lang="ts">
import { TermsContent } from '@olydor/ui'
import { useI18n } from '../utils/i18n'

const { t, currentLang } = useI18n()

useSeoMeta({
  title: () => t('legalTermsSeoTitle'),
  description: () => t('legalTermsSeoDesc'),
})
</script>
