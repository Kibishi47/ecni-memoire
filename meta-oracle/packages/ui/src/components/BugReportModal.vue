<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
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
              <h2 id="mo-bug-modal-title" class="text-lg font-bold">
                {{ lang === 'en' ? 'Report an Issue' : 'Signaler un bug ou une carte erronée' }}
              </h2>
              <p class="text-xs" style="color: var(--text-secondary)">
                {{ lang === 'en' ? 'Sent directly to Meta Oracle maintainers' : 'Transmis directement à l’équipe Meta Oracle via api.meta-oracle.com' }}
              </p>
            </div>
          </div>

          <button
            type="button"
            class="rounded-lg p-1.5 transition hover:bg-white/10"
            style="color: var(--text-secondary)"
            :aria-label="lang === 'en' ? 'Close' : 'Fermer'"
            @click="closeModal"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <form class="mt-4 space-y-4" @submit.prevent="handleSubmit">
          <div>
            <label class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color: var(--text-secondary)">
              {{ lang === 'en' ? 'Issue Type' : 'Type de signalement' }}
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
                <div>CARD_MODEL_ERROR</div>
                <div class="mt-0.5 text-[11px] font-normal opacity-80">
                  {{ lang === 'en' ? 'Compiled card effect / stats' : 'Modèle ou effet d’une carte' }}
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
                <div>ENGINE_RULE_ERROR</div>
                <div class="mt-0.5 text-[11px] font-normal opacity-80">
                  {{ lang === 'en' ? 'TCG rule / 3-ply AI behavior' : 'Règle TCG / décision IA 3-ply' }}
                </div>
              </button>
            </div>
          </div>

          <div>
            <label for="mo-bug-card-id" class="block text-xs font-semibold uppercase tracking-wider mb-1.5" style="color: var(--text-secondary)">
              {{ lang === 'en' ? 'Card ID (e.g. sv03-125)' : 'Identifiant de carte (ex: sv03-125)' }}
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
              {{ lang === 'en' ? 'Description' : 'Description du problème observé' }}
            </label>
            <textarea
              id="mo-bug-comment"
              v-model="userComment"
              rows="3"
              maxlength="1000"
              :placeholder="lang === 'en'
                ? 'Describe the expected behavior vs what Meta Oracle did...'
                : 'Décrivez le comportement attendu vs ce que Meta Oracle a exécuté...'"
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
            style="border-color: rgba(239, 68, 68, 0.4); background-color: rgba(239, 68, 68, 0.12); color: #fca5a5"
          >
            <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
            <span>{{ errorMessage }}</span>
          </div>

          <div
            v-if="submittedResult"
            class="rounded-lg border px-3 py-2.5 text-xs"
            style="border-color: rgba(16, 185, 129, 0.4); background-color: rgba(16, 185, 129, 0.12); color: #6ee7b7"
          >
            <div class="flex items-center gap-2 font-semibold">
              <CheckCircle2 class="h-4 w-4 shrink-0" />
              <span>
                {{ lang === 'en'
                  ? `Report #${submittedResult.reportId} recorded successfully.`
                  : `Signalement #${submittedResult.reportId} enregistré avec succès.` }}
              </span>
            </div>
            <a
              v-if="submittedResult.issueUrl"
              :href="submittedResult.issueUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1 inline-block underline hover:text-white"
            >
              {{ submittedResult.issueUrl }}
            </a>
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              class="rounded-lg border px-4 py-2 text-xs font-semibold transition hover:bg-white/5"
              style="border-color: var(--border-subtle); color: var(--text-secondary)"
              @click="closeModal"
            >
              {{ lang === 'en' ? 'Close' : 'Fermer' }}
            </button>
            <button
              type="submit"
              :disabled="isSubmitting"
              class="mo-btn-solar inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs"
            >
              <Loader2 v-if="isSubmitting" class="h-3.5 w-3.5 animate-spin" />
              <span>
                {{ isSubmitting
                  ? (lang === 'en' ? 'Sending...' : 'Envoi en cours...')
                  : (lang === 'en' ? 'Submit Report' : 'Envoyer le signalement') }}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { AlertCircle, Bug, CheckCircle2, Loader2, X } from 'lucide-vue-next'
import type { BugReportPayload, BugReportResponse, BugReportType } from '@meta-oracle/types'

export interface BugReportModalProps {
  modelValue: boolean
  apiBaseUrl?: string
  defaultType?: BugReportType
  defaultCardId?: string
  contextLogs?: Record<string, unknown> | null
  lang?: 'fr' | 'en'
}

const props = withDefaults(defineProps<BugReportModalProps>(), {
  apiBaseUrl: 'https://api.meta-oracle.com',
  defaultType: 'CARD_MODEL_ERROR',
  defaultCardId: '',
  contextLogs: null,
  lang: 'fr',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submitted: [response: BugReportResponse]
}>()

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
    errorMessage.value =
      props.lang === 'en'
        ? 'Please enter a Card ID (e.g. sv03-125) for a card model report.'
        : 'Veuillez saisir un identifiant de carte (ex: sv03-125) pour une erreur de carte.'
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
    const baseUrl = props.apiBaseUrl.replace(/\/+$/, '')
    const response = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      let msg =
        props.lang === 'en'
          ? `Server error (${response.status})`
          : `Erreur serveur (${response.status})`
      try {
        const errJson = (await response.json()) as { message?: string; error?: string }
        if (response.status === 429) {
          const retry = response.headers.get('retry-after') || '60'
          msg =
            props.lang === 'en'
              ? `Too many reports sent. Please wait ${retry}s.`
              : `Trop de signalements envoyés. Réessayez dans ${retry}s.`
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
      err instanceof Error && err.message
        ? err.message
        : props.lang === 'en'
          ? 'Unable to reach Meta Oracle API.'
          : 'Impossible de joindre l’API Meta Oracle.'
  } finally {
    isSubmitting.value = false
  }
}
</script>
