import type { ApiMetaDeck } from './apiClient'
import type { EngineCardModel } from '../types/cardModel'
import type { MetaOpponentDeck } from '../types/deck'
import type { OpponentDeckDescriptor } from '../core/gameLoop'

export interface MappedMetaOpponent {
  metaDeck: MetaOpponentDeck
  descriptor: OpponentDeckDescriptor
}

const ACCENT_PALETTE: Array<MetaOpponentDeck['badgeColor']> = [
  'purple',
  'emerald',
  'amber',
  'indigo',
  'rose',
]

function inferBadgeColor(name: string, index: number): MetaOpponentDeck['badgeColor'] {
  const lower = name.toLowerCase()
  if (lower.includes('lanssorien') || lower.includes('dragapult')) return 'purple'
  if (lower.includes('kangourex') || lower.includes('kangaskhan') || lower.includes('bolt') || lower.includes('ire')) {
    return 'emerald'
  }
  if (lower.includes('roigada') || lower.includes('slowking')) return 'amber'
  return ACCENT_PALETTE[index % ACCENT_PALETTE.length]!
}

function buildPtcglTextFromApiCards(cards: ApiMetaDeck['cards']): string {
  const pokemonLines: string[] = []
  const trainerLines: string[] = []
  const energyLines: string[] = []
  let pokemonCount = 0
  let trainerCount = 0
  let energyCount = 0

  for (const entry of cards) {
    const id = entry.model.identity
    const name = id.nameEn || id.nameFr
    const line = `${entry.count} ${name} ${id.setId.toUpperCase()} ${id.localId}`
    if (entry.model.category === 'POKEMON') {
      pokemonLines.push(line)
      pokemonCount += entry.count
    } else if (entry.model.category === 'TRAINER') {
      trainerLines.push(line)
      trainerCount += entry.count
    } else {
      energyLines.push(line)
      energyCount += entry.count
    }
  }

  const sections: string[] = []
  if (pokemonLines.length > 0) {
    sections.push(`Pokémon: ${pokemonCount}\n${pokemonLines.join('\n')}`)
  }
  if (trainerLines.length > 0) {
    sections.push(`Trainer: ${trainerCount}\n${trainerLines.join('\n')}`)
  }
  if (energyLines.length > 0) {
    sections.push(`Energy: ${energyCount}\n${energyLines.join('\n')}`)
  }
  return sections.join('\n\n')
}

function extractKeyThreats(
  cards: ApiMetaDeck['cards'],
  lang: 'fr' | 'en',
): string[] {
  const pokemonEntries = cards
    .filter((c) => c.model.category === 'POKEMON')
    .sort((a, b) => {
      const aRule = a.model.pokemonStats?.isRuleBox ? 1 : 0
      const bRule = b.model.pokemonStats?.isRuleBox ? 1 : 0
      if (bRule !== aRule) return bRule - aRule
      const aHp = a.model.pokemonStats?.hp ?? 0
      const bHp = b.model.pokemonStats?.hp ?? 0
      if (bHp !== aHp) return bHp - aHp
      return b.count - a.count
    })

  const seen = new Set<string>()
  const threats: string[] = []
  for (const entry of pokemonEntries) {
    const label = lang === 'en' ? entry.model.identity.nameEn || entry.model.identity.nameFr : entry.model.identity.nameFr
    if (!seen.has(label)) {
      seen.add(label)
      threats.push(label)
    }
    if (threats.length >= 3) break
  }
  return threats
}

export function mapApiMetaDecks(apiDecks: ApiMetaDeck[]): MappedMetaOpponent[] {
  return apiDecks.map((apiDeck, idx) => {
    const id = `meta_api_${apiDeck.id}`
    const badgeColor = inferBadgeColor(apiDeck.name, idx)
    const archetypeBadge = apiDeck.archetype?.trim() || 'Meta Standard'
    const keyThreats = extractKeyThreats(apiDeck.cards, 'fr')
    const keyThreatsEn = extractKeyThreats(apiDeck.cards, 'en')

    const models: EngineCardModel[] = []
    for (const entry of apiDeck.cards) {
      for (let q = 0; q < entry.count; q++) {
        models.push(entry.model)
      }
    }

    const subtitleFr =
      keyThreats.length > 0
        ? `Archétype ${archetypeBadge} (${apiDeck.totalCards} cartes) axé sur ${keyThreats.slice(0, 2).join(' & ')}.`
        : `Deck compétitif ${archetypeBadge} (${apiDeck.totalCards} cartes).`
    const subtitleEn =
      keyThreatsEn.length > 0
        ? `${archetypeBadge} archetype (${apiDeck.totalCards} cards) featuring ${keyThreatsEn.slice(0, 2).join(' & ')}.`
        : `${archetypeBadge} competitive deck (${apiDeck.totalCards} cards).`

    const metaDeck: MetaOpponentDeck = {
      id,
      name: apiDeck.name,
      nameEn: apiDeck.name,
      archetypeBadge,
      archetypeBadgeEn: archetypeBadge,
      strategySubtitle: subtitleFr,
      strategySubtitleEn: subtitleEn,
      description: subtitleFr,
      descriptionEn: subtitleEn,
      keyThreats,
      keyThreatsEn,
      badgeColor,
      ptcglText: buildPtcglTextFromApiCards(apiDeck.cards),
    }

    const descriptor: OpponentDeckDescriptor = {
      id,
      name: apiDeck.name,
      nameEn: apiDeck.name,
      archetypeTag: archetypeBadge,
      archetypeTagEn: archetypeBadge,
      accentColor: badgeColor,
      models,
    }

    return { metaDeck, descriptor }
  })
}
