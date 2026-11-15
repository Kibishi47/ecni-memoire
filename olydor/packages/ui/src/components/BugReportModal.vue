<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
      style="background-color: var(--bg-overlay)"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mo-bug-modal-title"
      @click.self="closeModal"
    >
      <div
        class="w-full max-w-lg rounded-2xl border p-6 shadow-2xl"
        style="background-color: var(--bg-surface); border-color: var(--border-subtle); color: var(--text-primary)"
      >
        <div class="flex items-start justify-between gap-4 border-b pb-4" style="border-color: var(--border-subtle)">
          <div class="flex items-center gap-2.5">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-lg"
              style="background-color: rgba(255, 107, 0, 0.14); color: var(--brand-primary)"
            >
              <Bug class="h-5 w-5" />
            </div>
            <div>
              <h2 id="mo-bug-modal-title" class="text-lg font-bold" style="color: var(--text-primary)">
                {{ t('bugModalTitle') }}
              </h2>
              <p class="text-xs" style="color: var(--text-secondary)">
                {{ t('bugModalSubtitle') }}
              </p>
            </div>
          </div>

          <button
            type="button"
            class="rounded-lg p-1.5 transition hover:opacity-80"
            style="color: var(--text-secondary)"
            :aria-label="t('bugModalCloseAria')"
            @click="closeModal"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <form class="mt-4 space-y-4" @submit.prevent="handleSubmit">
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color: var(--text-secondary)">
              {{ t('bugTypeLabel') }}
            </label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="rounded-lg border px-3 py-2 text-left text-xs font-semibold transition"
                :style="reportType === 'CARD_MODEL_ERROR'
                  ? 'border-color: var(--brand-primary); background-color: rgba(255, 107, 0, 0.14); color: var(--text-primary)'
                  : 'border-color: var(--border-subtle); background-color: var(--bg-elevated); color: var(--text-secondary)'"
                @click="reportType = 'CARD_MODEL_ERROR'"
              >
                <div>{{ t('bugTypeCardTitle') }}</div>
                <div class="mt-0.5 text-[11px] font-normal opacity-80">
                  {{ t('bugTypeCardDesc') }}
                </div>
              </button>

              <button
                type="button"
                class="rounded-lg border px-3 py-2 text-left text-xs font-semibold transition"
                :style="reportType === 'ENGINE_RULE_ERROR'
                  ? 'border-color: var(--brand-primary); background-color: rgba(255, 107, 0, 0.14); color: var(--text-primary)'
                  : 'border-color: var(--border-subtle); background-color: var(--bg-elevated); color: var(--text-secondary)'"
                @click="reportType = 'ENGINE_RULE_ERROR'"
              >
                <div>{{ t('bugTypeEngineTitle') }}</div>
                <div class="mt-0.5 text-[11px] font-normal opacity-80">
                  {{ t('bugTypeEngineDesc') }}
                </div>
              </button>
            </div>
          </div>

          <div>
            <label for="mo-bug-card-id" class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color: var(--text-secondary)">
              {{ t('bugCardIdLabel') }}
              <span v-if="reportType === 'CARD_MODEL_ERROR'" style="color: var(--brand-primary)">*</span>
            </label>
            <input
              id="mo-bug-card-id"
              v-model="cardId"
              type="text"
              maxlength="32"
              :required="reportType === 'CARD_MODEL_ERROR'"
              placeholder="sv03-125"
              class="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:ring-2"
              style="
                background-color: var(--bg-elevated);
                border-color: var(--border-subtle);
                color: var(--text-primary);
              "
            />
          </div>

          <div>
            <label for="mo-bug-comment" class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color: var(--text-secondary)">
              {{ t('bugDescLabel') }}
            </label>
            <textarea
              id="mo-bug-comment"
              v-model="userComment"
              rows="3"
              maxlength="1000"
              :placeholder="t('bugDescPlaceholder')"
              class="w-full rounded-lg border px-3 py-2 text-sm outline-none transition focus:ring-2"
              style="
                background-color: var(--bg-elevated);
                border-color: var(--border-subtle);
                color: var(--text-primary);
              "
            />
          </div>

          <div
            v-if="errorMessage"
            class="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
            style="border-color: rgba(239, 68, 68, 0.45); background-color: rgba(239, 68, 68, 0.12); color: var(--status-negative)"
          >
            <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
            <span>{{ errorMessage }}</span>
          </div>

          <div
            v-if="submittedResult"
            class="rounded-lg border px-3 py-2.5 text-xs"
            style="border-color: rgba(16, 185, 129, 0.45); background-color: rgba(16, 185, 129, 0.12); color: var(--status-positive)"
          >
            <div class="flex items-center gap-2 font-semibold">
              <CheckCircle2 class="h-4 w-4 shrink-0" />
              <span>
                {{ t('bugSuccessMsg', { id: submittedResult.reportId }) }}
              </span>
            </div>
            <a
              v-if="submittedResult.issueUrl"
              :href="submittedResult.issueUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1 inline-block underline hover:opacity-80"
              style="color: var(--ai-accent)"
            >
              {{ submittedResult.issueUrl }}
            </a>
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              class="rounded-lg border px-4 py-2 text-xs font-semibold transition hover:opacity-85"
              style="border-color: var(--border-subtle); color: var(--text-secondary)"
              @click="closeModal"
            >
              {{ t('bugCancel') }}
            </button>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="mo-btn-solar inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs"
            >
              <Loader2 v-if="isSubmitting" class="h-3.5 w-3.5 animate-spin" />
              <span>
                {{ isSubmitting ? t('bugSubmitting') : t('bugSubmit') }}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertCircle, Bug, CheckCircle2, Loader2, X } from 'lucide-vue-next'
import type { BugReportPayload, BugReportResponse, BugReportType } from '@olydor/types'
import { resolvePlatformUrls } from '../urls'
import { useUiI18n, type OlydorLang } from '../i18n'

export interface BugReportModalProps {
  modelValue: boolean
  apiBaseUrl?: string
  defaultType?: BugReportType
  defaultCardId?: string
  contextLogs?: Record<string, unknown> | null
  lang?: OlydorLang
}

const props = withDefaults(defineProps<BugReportModalProps>(), {
  apiBaseUrl: undefined,
  defaultType: 'CARD_MODEL_ERROR',
  defaultCardId: '',
  contextLogs: null,
  lang: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submitted: [response: BugReportResponse]
}>()

const { t } = useUiI18n(() => props.lang)

const resolvedApiBaseUrl = computed(
  () => resolvePlatformUrls({ apiUrl: props.apiBaseUrl }).apiUrl,
)

const reportType = ref<BugReportType>(props.defaultType)
const cardId = ref(props.defaultCardId)
const userComment = ref('')
const isSubmitting = ref(false)
const errorMessage = ref<string | null>(null)
const submittedResult = ref<BugReportResponse | null>(null)

watch(
  () => props.modelValue,
  (isOpen) => {
    if (isOpen) {
      reportType.value = props.defaultType
      cardId.value = props.defaultCardId || ''
      errorMessage.value = null
      submittedResult.value = null
    }
  },
)

function closeModal() {
  emit('update:modelValue', false)
}

async function handleSubmit() {
  if (isSubmitting.value) return
  errorMessage.value = null
  submittedResult.value = null

  const trimmedCardId = cardId.value.trim()
  if (reportType.value === 'CARD_MODEL_ERROR' && !trimmedCardId) {
    errorMessage.value = t('bugErrorMissingCardId')
    return
  }

  const trimmedComment = userComment.value.trim()
  const payload: BugReportPayload = {
    type: reportType.value,
    cardId: trimmedCardId || null,
    matchLogs:
      props.contextLogs ??
      (reportType.value === 'ENGINE_RULE_ERROR'
        ? {
            source: 'navbar-bug-modal',
            href: typeof window !== 'undefined' ? window.location.href : 'ssr',
            timestamp: new Date().toISOString(),
          }
        : null),
    userComment: trimmedComment || null,
  }

  isSubmitting.value = true
  try {
    const response = await fetch(`${resolvedApiBaseUrl.value}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      let msg = t('bugErrorServer', { status: response.status })
      try {
        const errJson = (await response.json()) as { message?: string; error?: string }
        if (response.status === 429) {
          const retry = response.headers.get('retry-after') || '60'
          msg = t('bugErrorRateLimit', { retry })
        } else if (errJson.message || errJson.error) {
          msg = errJson.message || errJson.error || msg
        }
      } catch {
        // fallback message
      }
      errorMessage.value = msg
      return
    }

    const result = (await response.json()) as BugReportResponse
    submittedResult.value = result
    userComment.value = ''
    emit('submitted', result)
  } catch (err) {
    errorMessage.value =
      err instanceof Error && err.message ? err.message : t('bugErrorNetwork')
  } finally {
    isSubmitting.value = false
  }
}
</script>
