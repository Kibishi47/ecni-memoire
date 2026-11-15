<template>
  <div class="relative overflow-hidden">
    <!-- Ambient atmospheric backdrop -->
    <div
      class="pointer-events-none absolute -top-28 left-1/4 h-96 w-96 rounded-full opacity-20 blur-3xl"
      style="background: radial-gradient(circle, rgba(56, 189, 248, 0.35), transparent 70%)"
    />
    <div
      class="pointer-events-none absolute top-40 right-1/5 h-80 w-80 rounded-full opacity-15 blur-3xl"
      style="background: radial-gradient(circle, rgba(255, 107, 0, 0.3), transparent 70%)"
    />

    <!-- BIG COMING SOON HERO SECTION -->
    <section
      data-testid="arena-coming-soon-hero"
      class="relative border-b mo-obsidian-grid"
      style="border-color: var(--border-subtle)"
    >
      <div class="mx-auto max-w-7xl px-4 pt-14 pb-12 sm:px-6 lg:px-8">
        <div class="mx-auto max-w-4xl text-center">
          <div class="mb-6 flex justify-center">
            <div class="rounded-full p-3" style="box-shadow: var(--brand-glow)">
              <OlydorLogo size="xl" :show-text="false" />
            </div>
          </div>

          <!-- Large Display COMING SOON Banner -->
          <div class="mb-4">
            <span
              class="block text-5xl sm:text-7xl font-black tracking-[0.18em] uppercase mo-gradient-text select-none"
            >
              {{ t('comingSoonSuperTitle') }}
            </span>
          </div>

          <!-- Glowing Status Pill -->
          <div
            class="inline-flex items-center gap-2.5 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-widest mb-6"
            style="
              border-color: rgba(56, 189, 248, 0.45);
              background: rgba(56, 189, 248, 0.1);
              color: var(--ai-accent);
              box-shadow: 0 0 24px rgba(56, 189, 248, 0.18);
            "
          >
            <span class="relative flex h-2 w-2">
              <span
                class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style="background-color: var(--ai-accent)"
              />
              <span
                class="relative inline-flex rounded-full h-2 w-2"
                style="background-color: var(--ai-accent)"
              />
            </span>
            <span>⚔️ {{ t('heroBadge') }}</span>
          </div>

          <h1 class="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight" style="color: var(--text-primary)">
            <span>{{ t('heroTitlePrefix') }}</span>
            <span style="color: var(--ai-accent)">Pythia</span>
            <span>{{ t('heroTitleMiddle') }}</span>
            <span class="mo-gradient-text">Olydor</span>
          </h1>

          <p
            class="mt-4 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed"
            style="color: var(--text-secondary)"
          >
            {{ t('heroSubtitle') }}
          </p>

          <!-- 3-Step Rollout Progress Cards -->
          <div class="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-3 text-left">
            <div class="mo-card p-4">
              <div class="flex items-center justify-between text-xs font-bold" style="color: var(--status-positive)">
                <span>01</span>
                <span>✓ {{ t('milestone1Status') }}</span>
              </div>
              <div class="mt-1 text-sm font-bold" style="color: var(--text-primary)">
                {{ t('milestone1Label') }}
              </div>
            </div>
            <div class="mo-card p-4">
              <div class="flex items-center justify-between text-xs font-bold" style="color: var(--brand-primary)">
                <span>02</span>
                <span>● {{ t('milestone2Status') }}</span>
              </div>
              <div class="mt-1 text-sm font-bold" style="color: var(--text-primary)">
                {{ t('milestone2Label') }}
              </div>
            </div>
            <div
              class="mo-card p-4"
              style="border-color: rgba(56, 189, 248, 0.45); background-color: var(--bg-elevated)"
            >
              <div class="flex items-center justify-between text-xs font-bold" style="color: var(--ai-accent)">
                <span>03</span>
                <span>⏳ {{ t('milestone3Status') }}</span>
              </div>
              <div class="mt-1 text-sm font-bold" style="color: var(--text-primary)">
                {{ t('milestone3Label') }}
              </div>
            </div>
          </div>

          <!-- Primary Action Bar -->
          <div class="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              :href="ALPHA_FEEDBACK_FORM_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="mo-btn-solar inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold"
            >
              <Vote class="h-4 w-4" />
              <span>{{ t('ctaVoteAlpha') }}</span>
            </a>
            <a
              :href="simReturnUrl"
              data-testid="arena-return-insight"
              class="inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-semibold transition hover:brightness-110"
              style="border-color: var(--border-subtle); background-color: var(--bg-surface); color: var(--text-primary)"
            >
              <Cpu class="h-4 w-4" style="color: var(--brand-primary)" />
              <span>{{ t('ctaSimNow') }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- ?deck= INCOMING DEEP-LINK BANNER -->
    <section v-if="incomingDeckParam" class="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
      <div
        class="rounded-2xl border p-6 shadow-xl"
        :style="
          decodedParsedDeck?.isValid60
            ? 'border-color: rgba(16, 185, 129, 0.45); background-color: var(--bg-surface)'
            : 'border-color: rgba(245, 158, 11, 0.45); background-color: var(--bg-surface)'
        "
      >
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div class="space-y-2">
            <div class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              <CheckCircle2
                v-if="decodedParsedDeck?.isValid60"
                class="h-4 w-4"
                style="color: var(--status-positive)"
              />
              <AlertTriangle v-else class="h-4 w-4" style="color: var(--status-warning)" />
              <span
                :style="{
                  color: decodedParsedDeck?.isValid60 ? 'var(--status-positive)' : 'var(--status-warning)',
                }"
              >
                {{ decodedParsedDeck?.isValid60 ? t('deckValidBadge') : t('deckDecodedBadge') }}
              </span>
            </div>

            <h2 class="text-lg sm:text-xl font-bold" style="color: var(--text-primary)">
              <template v-if="decodedParsedDeck?.isValid60">
                {{ t('deckValidHeadline') }}
              </template>
              <template v-else-if="decodedParsedDeck">
                {{ t('deckIncompleteHeadline', { count: decodedParsedDeck.totalCards }) }}
              </template>
              <template v-else>
                {{ t('deckErrorHeadline') }}
              </template>
            </h2>

            <div
              v-if="decodedParsedDeck"
              class="flex flex-wrap items-center gap-3 pt-1 text-xs font-medium"
              style="color: var(--text-secondary)"
            >
              <span class="rounded-lg border px-2.5 py-1" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                {{ t('deckStatTotal') }} <strong style="color: var(--text-primary)">{{ decodedParsedDeck.totalCards }}</strong> / 60
              </span>
              <span class="rounded-lg border px-2.5 py-1" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                {{ t('deckStatPokemon') }} <strong style="color: var(--text-primary)">{{ decodedParsedDeck.pokemonCount }}</strong>
              </span>
              <span class="rounded-lg border px-2.5 py-1" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                {{ t('deckStatTrainers') }} <strong style="color: var(--text-primary)">{{ decodedParsedDeck.trainerCount }}</strong>
              </span>
              <span class="rounded-lg border px-2.5 py-1" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                {{ t('deckStatEnergy') }} <strong style="color: var(--text-primary)">{{ decodedParsedDeck.energyCount }}</strong>
              </span>
              <span
                v-if="catalogLoaded"
                class="rounded-lg border px-2.5 py-1"
                style="border-color: var(--border-subtle); background-color: var(--bg-canvas)"
              >
                {{ t('deckStatResolution') }}
                <strong
                  :style="{
                    color: decodedParsedDeck.isFullyResolved ? 'var(--status-positive)' : 'var(--status-warning)',
                  }"
                >
                  {{ decodedParsedDeck.isFullyResolved ? t('deckResolutionReady') : t('deckResolutionPartial') }}
                </strong>
              </span>
            </div>
          </div>

          <div class="flex flex-shrink-0 flex-wrap items-center gap-3">
            <a
              :href="simReturnUrl"
              class="mo-btn-solar inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold"
            >
              <Swords class="h-4 w-4" />
              <span>{{ t('deckLaunchSimBtn') }}</span>
              <ArrowRight class="h-4 w-4" />
            </a>
          </div>
        </div>

        <!-- Compact preview of parsed deck entries -->
        <div
          v-if="decodedParsedDeck && decodedParsedDeck.cards.length > 0"
          class="mt-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 border-t pt-4"
          style="border-color: var(--border-subtle)"
        >
          <div
            v-for="entry in decodedParsedDeck.cards.slice(0, 10)"
            :key="`${entry.uid}_${entry.name}`"
            class="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs"
            style="border-color: var(--border-subtle); background-color: var(--bg-canvas)"
          >
            <span class="truncate font-medium" style="color: var(--text-primary)">
              <strong style="color: var(--brand-primary)">{{ entry.quantity }}x</strong> {{ entry.name }}
            </span>
            <span class="ml-1 font-mono text-[10px]" style="color: var(--text-muted)">
              {{ entry.setCode }}
            </span>
          </div>
          <div
            v-if="decodedParsedDeck.cards.length > 10"
            class="flex items-center justify-center rounded-lg border border-dashed px-2.5 py-1.5 text-xs"
            style="border-color: var(--border-subtle); color: var(--text-secondary)"
          >
            {{ t('deckMoreCards', { count: decodedParsedDeck.cards.length - 10 }) }}
          </div>
        </div>
      </div>
    </section>

    <!-- INTERACTIVE 1v1 BOT BATTLE BOARD PREVIEW -->
    <section class="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div
        class="rounded-2xl border p-5 sm:p-7 shadow-2xl"
        style="border-color: var(--border-subtle); background-color: var(--bg-surface)"
      >
        <!-- Board Header + Scenario Switcher -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b pb-5" style="border-color: var(--border-subtle)">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl border"
              style="border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.1); color: var(--ai-accent)"
            >
              <Swords class="h-5 w-5" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-base sm:text-lg font-bold" style="color: var(--text-primary)">
                  {{ t('boardTitle') }}
                </h2>
                <span
                  class="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style="background: rgba(56, 189, 248, 0.14); color: var(--ai-accent)"
                >
                  {{ t('boardBadge') }}
                </span>
              </div>
              <p class="text-xs" style="color: var(--text-secondary)">
                {{ t('boardSubtitlePrefix') }}<strong style="color: var(--ai-accent)">{{ t('pythiaTag') }}</strong>{{ t('boardSubtitleSuffix') }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="(sc, idx) in scenarios"
              :key="sc.id"
              type="button"
              class="rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all"
              :style="
                selectedScenarioIdx === idx
                  ? 'border-color: var(--ai-accent); background: rgba(56, 189, 248, 0.15); color: var(--ai-accent)'
                  : 'border-color: var(--border-subtle); background: var(--bg-canvas); color: var(--text-secondary)'
              "
              @click="selectedScenarioIdx = idx"
            >
              {{ sc.label }}
            </button>
          </div>
        </div>

        <!-- BOARD MOCKUP + TURN ACTION LOG (NO PLAN EXPOSURE OR COACHING) -->
        <div class="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <!-- Left 7 cols: Player vs Pythia Bot board -->
          <div class="lg:col-span-7 space-y-4">
            <!-- Pythia Bot Zone -->
            <div
              class="rounded-xl border p-4"
              style="border-color: rgba(56, 189, 248, 0.35); background-color: var(--bg-elevated)"
            >
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <Bot class="h-4 w-4" style="color: var(--ai-accent)" />
                  <span class="text-xs font-bold uppercase tracking-wider" style="color: var(--ai-accent)">
                    {{ t('pythiaTag') }} — {{ activeScenario.pythiaDeck }}
                  </span>
                </div>
                <span class="text-xs font-mono" style="color: var(--text-secondary)">
                  {{ t('prizesLabel') }} <strong style="color: var(--text-primary)">{{ activeScenario.pythiaPrizes }}</strong>/6 · {{ t('handShortLabel') }} 5
                </span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="rounded-lg border p-3" style="border-color: rgba(56, 189, 248, 0.35); background-color: var(--bg-canvas)">
                  <div class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--ai-accent)">
                    {{ t('activeSpotAi') }}
                  </div>
                  <div class="mt-1 flex items-center justify-between">
                    <span class="text-sm font-bold" style="color: var(--text-primary)">{{ activeScenario.pythiaActive.name }}</span>
                    <span class="font-mono text-xs font-bold" style="color: var(--status-warning)">
                      {{ activeScenario.pythiaActive.hp }} {{ t('hpUnit') }}
                    </span>
                  </div>
                  <div class="mt-1.5 text-[11px]" style="color: var(--text-secondary)">
                    {{ activeScenario.pythiaActive.energy }} · {{ activeScenario.pythiaActive.status }}
                  </div>
                </div>

                <div class="rounded-lg border p-3" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                  <div class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--text-muted)">
                    {{ t('benchAi') }}
                  </div>
                  <ul class="mt-1.5 space-y-1 text-xs" style="color: var(--text-secondary)">
                    <li v-for="b in activeScenario.pythiaBench" :key="b" class="truncate">• {{ b }}</li>
                  </ul>
                </div>
              </div>
            </div>

            <!-- VS Center Line -->
            <div class="flex items-center justify-center gap-4 py-1">
              <div class="h-px flex-1" style="background-color: var(--border-subtle)" />
              <span
                class="rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
                style="border-color: rgba(255, 107, 0, 0.45); background: rgba(255, 107, 0, 0.1); color: var(--brand-primary)"
              >
                {{ activeScenario.turnLabel }}{{ t('vsDividerSuffix') }}
              </span>
              <div class="h-px flex-1" style="background-color: var(--border-subtle)" />
            </div>

            <!-- Player Zone -->
            <div
              class="rounded-xl border p-4"
              style="border-color: rgba(255, 107, 0, 0.35); background-color: var(--bg-elevated)"
            >
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <Swords class="h-4 w-4" style="color: var(--brand-primary)" />
                  <span class="text-xs font-bold uppercase tracking-wider" style="color: var(--brand-primary)">
                    {{ t('playerLabel') }} — {{ activeScenario.playerDeck }}
                  </span>
                </div>
                <span class="text-xs font-mono" style="color: var(--text-secondary)">
                  {{ t('prizesLabel') }} <strong style="color: var(--text-primary)">{{ activeScenario.playerPrizes }}</strong>/6 · {{ t('handShortLabel') }} 6
                </span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div class="rounded-lg border p-3" style="border-color: rgba(16, 185, 129, 0.35); background-color: var(--bg-canvas)">
                  <div class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--status-positive)">
                    {{ t('activeSpotPlayer') }}
                  </div>
                  <div class="mt-1 flex items-center justify-between">
                    <span class="text-sm font-bold" style="color: var(--text-primary)">{{ activeScenario.playerActive.name }}</span>
                    <span class="font-mono text-xs font-bold" style="color: var(--status-positive)">
                      {{ activeScenario.playerActive.hp }} {{ t('hpUnit') }}
                    </span>
                  </div>
                  <div class="mt-1.5 text-[11px]" style="color: var(--text-secondary)">
                    {{ activeScenario.playerActive.energy }} · {{ activeScenario.playerActive.status }}
                  </div>
                </div>

                <div class="rounded-lg border p-3" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                  <div class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--text-muted)">
                    {{ t('benchPlayer') }}
                  </div>
                  <ul class="mt-1.5 space-y-1 text-xs" style="color: var(--text-secondary)">
                    <li v-for="b in activeScenario.playerBench" :key="b" class="truncate">• {{ b }}</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <!-- Right 5 cols: Factual Turn Action Log + Unassisted Match Rules -->
          <div class="lg:col-span-5 flex flex-col gap-4">
            <!-- Turn Action Log -->
            <div
              class="rounded-xl border p-4 flex-1"
              style="border-color: var(--border-subtle); background-color: var(--bg-canvas)"
            >
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <Sparkles class="h-4 w-4" style="color: var(--ai-accent)" />
                  <h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--ai-accent)">
                    {{ t('matchLogTitle') }}
                  </h3>
                </div>
                <span class="font-mono text-[10px]" style="color: var(--text-muted)">1v1 Bot Match</span>
              </div>

              <div class="space-y-2.5 text-xs">
                <div
                  v-for="(entry, eIdx) in activeScenario.actionLog"
                  :key="eIdx"
                  class="rounded-lg border p-2.5"
                  style="border-color: var(--border-subtle); background: var(--bg-surface)"
                >
                  <div class="flex items-center justify-between font-mono text-[11px]">
                    <span
                      class="font-bold"
                      :style="{ color: entry.actor === 'PYTHIA' ? 'var(--ai-accent)' : 'var(--brand-primary)' }"
                    >
                      {{ entry.actor === 'PYTHIA' ? t('pythiaTag') : t('playerLabel') }}
                    </span>
                    <span style="color: var(--text-muted)">
                      {{ entry.phase }}
                    </span>
                  </div>
                  <p class="mt-1 leading-snug" style="color: var(--text-secondary)">
                    {{ entry.action }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Unassisted Duel Rules -->
            <div
              class="rounded-xl border p-4"
              style="border-color: var(--border-subtle); background-color: var(--bg-elevated)"
            >
              <div class="flex items-center justify-between mb-2.5">
                <div class="flex items-center gap-2">
                  <Bot class="h-4 w-4" style="color: var(--brand-primary)" />
                  <h3 class="text-xs font-bold uppercase tracking-wider" style="color: var(--text-primary)">
                    {{ t('matchRulesTitle') }}
                  </h3>
                </div>
                <span
                  class="rounded px-2 py-0.5 font-mono text-[10px] font-bold"
                  style="background: rgba(56, 189, 248, 0.14); color: var(--ai-accent)"
                >
                  {{ t('matchRulesBadge') }}
                </span>
              </div>

              <div class="space-y-2 text-xs">
                <div class="rounded-lg border p-2.5" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                  <div class="font-semibold" style="color: var(--text-primary)">
                    {{ t('matchRulesItem1Title') }}
                  </div>
                  <p class="mt-0.5 text-[11px]" style="color: var(--text-secondary)">
                    {{ t('matchRulesItem1Desc') }}
                  </p>
                </div>
                <div class="rounded-lg border p-2.5" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                  <div class="font-semibold" style="color: var(--text-primary)">
                    {{ t('matchRulesItem2Title') }}
                  </div>
                  <p class="mt-0.5 text-[11px]" style="color: var(--text-secondary)">
                    {{ t('matchRulesItem2Desc') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ARCHITECTURE & ROADMAP PRIORITY VOTING -->
    <section class="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div
          class="lg:col-span-6 rounded-2xl border p-6"
          style="border-color: var(--border-subtle); background-color: var(--bg-surface)"
        >
          <h3 class="text-lg font-bold" style="color: var(--text-primary)">
            {{ t('archTitle') }}
          </h3>
          <dl class="mt-4 space-y-3 text-xs sm:text-sm">
            <div class="rounded-xl border p-3.5" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
              <dt class="font-bold" style="color: var(--text-primary)">{{ t('archItem1Title') }}</dt>
              <dd class="mt-1" style="color: var(--text-secondary)">
                {{ t('archItem1Desc') }}
              </dd>
            </div>
            <div class="rounded-xl border p-3.5" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
              <dt class="font-bold" style="color: var(--text-primary)">{{ t('archItem2Title') }}</dt>
              <dd class="mt-1" style="color: var(--text-secondary)">
                {{ t('archItem2Desc') }}
              </dd>
            </div>
            <div class="rounded-xl border p-3.5" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
              <dt class="font-bold" style="color: var(--text-primary)">{{ t('archItem3Title') }}</dt>
              <dd class="mt-1" style="color: var(--text-secondary)">
                {{ t('archItem3Desc') }}
              </dd>
            </div>
          </dl>
        </div>

        <!-- Feature Priority Vote CTA -->
        <div
          class="lg:col-span-6 rounded-2xl border p-6 flex flex-col justify-between"
          style="
            border-color: rgba(255, 107, 0, 0.35);
            background-color: var(--bg-surface);
          "
        >
          <div>
            <div
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider mb-3"
              style="background: rgba(255, 107, 0, 0.16); color: var(--brand-primary)"
            >
              {{ t('roadmapBadge') }}
            </div>
            <h3 class="text-lg font-bold" style="color: var(--text-primary)">
              {{ t('roadmapTitle') }}
            </h3>
            <p class="mt-2 text-sm" style="color: var(--text-secondary)">
              {{ t('roadmapSubtitle') }}
            </p>

            <ul class="mt-4 space-y-2.5 text-sm">
              <li class="flex items-start gap-2.5 rounded-xl border p-3" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                <span class="font-mono font-bold" style="color: var(--brand-primary)">01</span>
                <div>
                  <strong style="color: var(--text-primary)">{{ t('roadmapItem1Title') }}</strong>
                  <p class="text-xs" style="color: var(--text-secondary)">
                    {{ t('roadmapItem1Desc') }}
                  </p>
                </div>
              </li>
              <li class="flex items-start gap-2.5 rounded-xl border p-3" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                <span class="font-mono font-bold" style="color: var(--brand-amber)">02</span>
                <div>
                  <strong style="color: var(--text-primary)">{{ t('roadmapItem2Title') }}</strong>
                  <p class="text-xs" style="color: var(--text-secondary)">
                    {{ t('roadmapItem2Desc') }}
                  </p>
                </div>
              </li>
              <li class="flex items-start gap-2.5 rounded-xl border p-3" style="border-color: var(--border-subtle); background-color: var(--bg-canvas)">
                <span class="font-mono font-bold" style="color: var(--ai-accent)">03</span>
                <div>
                  <strong style="color: var(--text-primary)">{{ t('roadmapItem3Title') }}</strong>
                  <p class="text-xs" style="color: var(--text-secondary)">
                    {{ t('roadmapItem3Desc') }}
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <div class="mt-6 pt-4 border-t flex flex-wrap items-center justify-between gap-4" style="border-color: var(--border-subtle)">
            <span class="text-xs" style="color: var(--text-secondary)">
              {{ t('roadmapFooter') }}
            </span>
            <a
              :href="ALPHA_FEEDBACK_FORM_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="mo-btn-solar inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold"
            >
              <Vote class="h-4 w-4" />
              <span>{{ t('roadmapVoteBtn') }}</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, type Ref } from 'vue'
import type { ParsedDeck } from '@olydor/types'
import { decodeDeckFromUrl, parsePtcglDecklist, registerCompiledCards } from '@olydor/engine'
import {
  ALPHA_FEEDBACK_FORM_URL,
  OlydorLogo,
  resolvePlatformUrls,
  type OlydorLang,
} from '@olydor/ui'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  Sparkles,
  Swords,
  Vote,
} from 'lucide-vue-next'
import {
  getLocalizedArenaScenarios,
  type ArenaScenario,
  useArenaI18n,
} from '../utils/i18n'

const config = useRuntimeConfig()
const route = useRoute()
const injectedLang = inject<Ref<OlydorLang> | undefined>('olydorLang', undefined)
const { t, lang } = useArenaI18n(() => injectedLang?.value)

useSeoMeta({
  title: () => t('seoTitle'),
  description: () => t('seoDescription'),
  ogTitle: () => t('seoTitle'),
  ogDescription: () => t('seoDescription'),
  ogType: 'website',
  twitterCard: 'summary_large_image',
})

const catalogLoaded = ref(false)
const catalogBump = ref(0)

const incomingDeckParam = computed(() => {
  const q = route.query.deck
  return typeof q === 'string' && q.trim().length > 0 ? q.trim() : ''
})

const decodedDeckText = computed(() => {
  if (!incomingDeckParam.value) return ''
  return decodeDeckFromUrl(incomingDeckParam.value)
})

const decodedParsedDeck = computed<ParsedDeck | null>(() => {
  void catalogBump.value
  if (!decodedDeckText.value.trim()) return null
  return parsePtcglDecklist(decodedDeckText.value)
})

const simReturnUrl = computed(() => {
  const { insightUrl } = resolvePlatformUrls({ insightUrl: config.public.insightUrl })
  if (!incomingDeckParam.value) return insightUrl
  const sep = insightUrl.includes('?') ? '&' : '?'
  return `${insightUrl}${sep}deck=${encodeURIComponent(incomingDeckParam.value)}`
})

onMounted(async () => {
  if (!incomingDeckParam.value) return
  try {
    const res = await fetch('/cards_database.json')
    if (res.ok) {
      const json = (await res.json()) as unknown[]
      if (Array.isArray(json) && json.length > 0) {
        registerCompiledCards(json)
        catalogLoaded.value = true
        catalogBump.value++
      }
    }
  } catch {
    // Graceful degradation: PTCGL line parsing and 60-card check already succeeded without network.
  }
})

const scenarios = computed<ArenaScenario[]>(() => getLocalizedArenaScenarios(lang.value))
const selectedScenarioIdx = ref(0)
const activeScenario = computed(
  () => scenarios.value[selectedScenarioIdx.value] ?? scenarios.value[0]!,
)
</script>
