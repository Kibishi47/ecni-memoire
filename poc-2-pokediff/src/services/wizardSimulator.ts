import type { KeyCardItem, WizardResult, DeckArchetype } from '../types/wizard'

export function evaluateWizardComparison(
  deckId: DeckArchetype,
  cards: KeyCardItem[]
): WizardResult {
  // Find diffs compared to default
  const diffs = cards.filter((c) => c.currentCount !== c.defaultCount)

  const poffinDiff = (cards.find((c) => c.id === 'poffin')?.currentCount ?? 3) - 3
  const candyDiff = (cards.find((c) => c.id === 'candy')?.currentCount ?? 3) - 3
  const bossDiff = (cards.find((c) => c.id === 'boss')?.currentCount ?? 2) - 2
  const ultraDiff = (cards.find((c) => c.id === 'ultra')?.currentCount ?? 4) - 4
  const stretcherDiff = (cards.find((c) => c.id === 'stretcher')?.currentCount ?? 1) - 1

  const defaultEnergy = deckId === 'dracaufeu' ? 6 : 5
  const energyDiff = (cards.find((c) => c.id === 'energy')?.currentCount ?? defaultEnergy) - defaultEnergy

  // Baseline Rates
  const baseStability = 81
  const baseSpeed = 74
  const baseEnergyRisk = 12

  // 1. Calculate Stability at Tour 1
  // Poffin gives +6% per copy; ultra gives +1%; boss/stretcher give 0
  const stabilityDelta = Math.round(poffinDiff * 6 + ultraDiff * 1)
  const afterStability = Math.min(99, Math.max(40, baseStability + stabilityDelta))

  // 2. Calculate Speed at Tour 2
  // Super Bonbon gives +8% per copy; poffin gives +1%; ultra cut gives -1%
  const speedDelta = Math.round(candyDiff * 8 + poffinDiff * 1 + ultraDiff * 1)
  const afterSpeed = Math.min(99, Math.max(40, baseSpeed + speedDelta))

  // 3. Calculate Energy Risk
  // Cutting energy increases risk by +3% per energy cut
  const energyRiskDelta = Math.round(-energyDiff * 3 - stretcherDiff * 0.5)
  const afterEnergyRisk = Math.min(50, Math.max(2, baseEnergyRisk + energyRiskDelta))

  // Build change summary string
  let changeSummary = 'Aucun changement'
  const removed = diffs.filter((d) => d.currentCount < d.defaultCount)
  const added = diffs.filter((d) => d.currentCount > d.defaultCount)

  if (removed.length > 0 || added.length > 0) {
    const removeParts = removed.map((r) => `-${r.defaultCount - r.currentCount} ${r.name}`)
    const addParts = added.map((a) => `+${a.currentCount - a.defaultCount} ${a.name}`)
    changeSummary = `${removeParts.join(', ')} ➔ ${addParts.join(', ')}`
  }

  // Verdict One-liner & Recommendation
  let verdictOneLiner = ''
  let isRecommended = true

  if (poffinDiff > 0 && bossDiff < 0) {
    verdictOneLiner =
      'Ce changement est recommandé : vous réduisez nettement vos mains mortes au Tour 1 sans affaiblir votre attaque.'
    isRecommended = true
  } else if (candyDiff > 0 && ultraDiff < 0) {
    verdictOneLiner =
      'Ce changement est très efficace pour la vitesse : vous gagnez la course à l’évolution au Tour 2 face aux autres decks de Setup.'
    isRecommended = true
  } else if (stretcherDiff > 0 && energyDiff < 0) {
    verdictOneLiner =
      'Ce changement renforce votre résilience en fin de match, mais attention à la gestion serrée de vos énergies.'
    isRecommended = true
  } else if (stabilityDelta >= 0 && speedDelta >= 0 && energyRiskDelta <= 0) {
    verdictOneLiner =
      'Ce réglage améliore la régularité globale de votre deck sans désavantage majeur détecté.'
    isRecommended = true
  } else if (stabilityDelta < 0) {
    verdictOneLiner =
      'Attention : ce changement affaiblit votre mise en place au Tour 1. À tester avec précaution.'
    isRecommended = false
  } else {
    verdictOneLiner =
      'Un arbitrage équilibré qui modifie légèrement le tempo de vos parties selon les matchups rencontrés.'
    isRecommended = true
  }

  // Build Opponent Impacts (3 simple lines: Rapide, Évolution, Contrôle)
  const opponentImpacts = [
    {
      category: 'Contre un deck Rapide',
      archetypeExample: 'ex: Ire-Foudre, Miraidon',
      impactBadge:
        stabilityDelta > 0
          ? `Avantage (+${Math.abs(stabilityDelta)} %)`
          : stabilityDelta < 0
            ? `Défavorable (${stabilityDelta} %)`
            : 'Équilibré',
      impactType:
        stabilityDelta > 0 ? 'positive' : stabilityDelta < 0 ? 'negative' : 'neutral',
      description:
        stabilityDelta > 0
          ? 'Vous posez vos Pokémon de base indispensables pour absorber le premier K.O. précoce.'
          : 'Départ plus risqué si l’adversaire attaque dès le premier tour.',
    },
    {
      category: 'Contre un deck Évolution',
      archetypeExample: 'ex: Miroir Dracaufeu, Lanssorien',
      impactBadge:
        speedDelta > 0
          ? `Avantage (+${speedDelta} %)`
          : speedDelta < 0
            ? `Léger retard (${speedDelta} %)`
            : 'Équilibré',
      impactType: speedDelta > 0 ? 'positive' : speedDelta < 0 ? 'negative' : 'neutral',
      description:
        speedDelta > 0
          ? 'Vous évoluez souvent avant votre adversaire, ce qui vous donne l’avantage de tempo.'
          : 'Vitesse de mise en place équivalente à la liste classique.',
    },
    {
      category: 'Contre un deck Contrôle / Bloquant',
      archetypeExample: 'ex: Ronflex Stall, Craparoi',
      impactBadge:
        stretcherDiff > 0
          ? `Favorable (+6 %)`
          : bossDiff < 0
            ? `Moins de cibles (-2 %)`
            : 'Équilibré',
      impactType:
        stretcherDiff > 0 ? 'positive' : bossDiff < 0 ? 'negative' : 'neutral',
      description:
        stretcherDiff > 0
          ? 'La Civière supplémentaire permet de recycler un Pokémon ou une énergie bloquée.'
          : bossDiff < 0
            ? 'Vous avez 1 Ordres du Boss en moins pour cibler les Pokémon protégés sur le banc.'
            : 'Comportement similaire face aux blocages de jeu.',
    },
  ] as const

  return {
    changeSummary,
    verdictOneLiner,
    isRecommended,
    stabilityT1: {
      label: 'Stabilité au Tour 1',
      sublabel: 'Poser 2+ Pokémon de base dès l’ouverture',
      before: baseStability,
      after: afterStability,
      delta: stabilityDelta,
      badgeText:
        stabilityDelta > 0
          ? `+${stabilityDelta} %`
          : stabilityDelta < 0
            ? `${stabilityDelta} %`
            : 'Identique',
      badgeType:
        stabilityDelta > 0 ? 'positive' : stabilityDelta < 0 ? 'negative' : 'neutral',
      description: 'Garantit d’avoir vos cibles d’évolution prêtes dès le premier tour.',
    },
    speedT2: {
      label: 'Vitesse d’attaque au Tour 2',
      sublabel: 'Avoir l’évolution et l’énergie prêtes à attaquer',
      before: baseSpeed,
      after: afterSpeed,
      delta: speedDelta,
      badgeText:
        speedDelta > 0 ? `+${speedDelta} %` : speedDelta < 0 ? `${speedDelta} %` : 'Identique',
      badgeType: speedDelta > 0 ? 'positive' : speedDelta < 0 ? 'negative' : 'neutral',
      description: 'Probabilité de lancer votre première attaque majeure dès le second tour.',
    },
    energyRisk: {
      label: 'Risque de manquer d’énergie',
      sublabel: 'Panne d’énergie pour alimenter l’attaque',
      before: baseEnergyRisk,
      after: afterEnergyRisk,
      delta: energyRiskDelta,
      badgeText:
        energyRiskDelta > 0
          ? `+${energyRiskDelta} %`
          : energyRiskDelta < 0
            ? `${energyRiskDelta} %`
            : 'Identique',
      // For risk, an increase in risk is negative (red), a decrease is positive (green)
      badgeType:
        energyRiskDelta > 0 ? 'negative' : energyRiskDelta < 0 ? 'positive' : 'neutral',
      description: 'Risque de n’avoir pas assez d’énergie disponible au moment d’attaquer.',
    },
    opponentImpacts: [...opponentImpacts],
  }
}
