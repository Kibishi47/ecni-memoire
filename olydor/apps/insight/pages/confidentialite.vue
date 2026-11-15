<template>
  <PrivacyPolicyContent :lang="currentLang" />
</template>

<script setup lang="ts">
import { PrivacyPolicyContent } from '@olydor/ui'
import { useI18n } from '../utils/i18n'

const { t, currentLang } = useI18n()

useSeoMeta({
  title: () => t('legalPrivacySeoTitle'),
  description: () => t('legalPrivacySeoDesc'),
})
</script>
