import { ref } from 'vue'
import { formatRetryAfterDuration } from '@olydor/ui'
import { ApiError, submitBugReport, type BugReportPayload, type BugReportResponse } from './apiClient'
import { currentLang, t } from '../utils/i18n'

export function formatBugReportError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const seconds = err.retryAfterSeconds ?? 3600
      return t('reportRateLimitError', {
        retry: formatRetryAfterDuration(seconds, currentLang.value),
      })
    }
    return err.message || t('reportErrorGeneric')
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message
  }
  return t('reportErrorGeneric')
}

export function useBugReport() {
  const isPanelOpen = ref(false)
  const comment = ref('')
  const isSubmitting = ref(false)
  const error = ref<string | null>(null)
  const successResult = ref<BugReportResponse | null>(null)

  function reset() {
    isPanelOpen.value = false
    comment.value = ''
    isSubmitting.value = false
    error.value = null
    successResult.value = null
  }

  function togglePanel() {
    if (isPanelOpen.value) {
      isPanelOpen.value = false
      return
    }
    error.value = null
    successResult.value = null
    isPanelOpen.value = true
  }

  async function submit(payload: Omit<BugReportPayload, 'userComment'>): Promise<BugReportResponse | null> {
    if (isSubmitting.value) return null
    isSubmitting.value = true
    error.value = null
    successResult.value = null

    try {
      const trimmedComment = comment.value.trim()
      const res = await submitBugReport({
        ...payload,
        userComment: trimmedComment.length > 0 ? trimmedComment : null,
      })
      successResult.value = res
      comment.value = ''
      return res
    } catch (err) {
      error.value = formatBugReportError(err)
      return null
    } finally {
      isSubmitting.value = false
    }
  }

  return {
    isPanelOpen,
    comment,
    isSubmitting,
    error,
    successResult,
    reset,
    togglePanel,
    submit,
  }
}
